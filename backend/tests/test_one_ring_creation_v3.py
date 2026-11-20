import json
import subprocess
from pathlib import Path
import pytest
from app.domain.one_ring_creation import prepare_creation, initial_inventory, evaluate_creation
from app.domain.sheet_creation import prepare_sheet_creation

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads(subprocess.check_output(['node','--experimental-strip-types',str(ROOT/'frontend/tests/one-ring-parity.mjs')],encoding='utf-8'))
STARTER = json.loads((ROOT/'backend/tests/fixtures/one_ring_v3_starter.json').read_text(encoding='utf-8'))
FIELDS = STARTER['template']['fields']

@pytest.mark.parametrize('case',CASES,ids=lambda c:f"{c['input']['linhagem']}/{c['input']['vocacao']}/{c['input']['anel_atributos']}/{c['input'].get('anel_bonus_atributo','')}")
def test_client_server_parity(case):
    result=prepare_creation(case['input'],case['input']['nome'],FIELDS)
    assert result==case['expected']['values']
    assert initial_inventory(result)==case['expected']['inventory']
    template={'name':STARTER['template']['name'],'version':3,'schema':STARTER['template']}
    _,_,persisted=prepare_sheet_creation(template,case['input']['nome'],case['expected']['values'])
    assert persisted==case['expected']['values']

@pytest.mark.parametrize('field,value',[('corpo',99),('vigor_marcha',99),('esperanca',99),('carga',0),('experiencia',50)])
def test_reject_tampered_derived(field,value):
    v={**CASES[0]['expected']['values'],field:value}
    with pytest.raises(ValueError): prepare_creation(v,v['nome'],FIELDS)

def test_previous_xp_accumulates_across_both_pools():
    v={**CASES[0]['input'],'stealth':3,CASES[0]['input']['anel_combate_principal']:3}
    with pytest.raises(ValueError,match='10 pontos'):prepare_creation(v,v['nome'],FIELDS)

def test_report_incomplete_has_field_problems():
    result=evaluate_creation({})
    assert any(p['field']=='linhagem' for p in result['errors'])
    assert result['inventory']==[]

@pytest.fixture
def v3_api(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.adapters.inbound.http import sheets
    from tests.support.fake_supabase import FakeSupabase, use_fake_supabase
    app = FastAPI()
    app.include_router(sheets.router)
    template = {'name': STARTER['template']['name'], 'version': 3, 'schema': STARTER['template']}

    def respond(method, path, _params, payload):
        if method == 'GET' and path == 'system_templates':
            return [template]
        return {'id': '84000000-0000-4000-8000-000000000001', 'values': payload['p_values']}

    supabase = FakeSupabase(user_id='81000000-0000-4000-8000-000000000001', on_request=respond)
    use_fake_supabase(app, supabase)
    return TestClient(app), supabase

def test_validate_endpoint_fields_and_derivatives(v3_api):
    client,_=v3_api
    endpoint='/api/v1/campaigns/82000000-0000-4000-8000-000000000001/sheets/validate-creation'
    data={'template_id':'83000000-0000-4000-8000-000000000001','values':CASES[0]['expected']['values']}
    response=client.post(endpoint,json=data,headers={'Authorization':'Bearer fixture'})
    assert response.status_code==200
    assert response.json()['valid'] is True
    assert response.json()['derived']==CASES[0]['expected']['derived']
    bad=client.post(endpoint,json={**data,'values':{**data['values'],'unknown':1}},headers={'Authorization':'Bearer fixture'})
    assert bad.json()['valid'] is False
    assert any(p['field']=='unknown' for p in bad.json()['field_problems'])

def test_creation_endpoint_atomic_rpc(v3_api):
    client, supabase = v3_api
    response = client.post('/api/v1/campaigns/82000000-0000-4000-8000-000000000001/sheets', headers={'Authorization': 'Bearer fixture'},
                           json={'template_id': '83000000-0000-4000-8000-000000000001', 'name': CASES[0]['input']['nome'], 'values': CASES[0]['expected']['values']})
    assert response.status_code == 201, response.text
    creation = supabase.requests[-1]
    assert (creation.method, creation.path) == ('POST', 'rpc/create_one_ring_sheet')
    assert creation.payload['p_values']['experiencia'] == 0
