"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createClient } from "../lib/supabase/client";
import { ATLAS_EQUIPMENT, type AtlasEquipment } from "../lib/atlas-equipment";

type ShoppingList = { id: string; name: string; owner_id: string; shared_with_master: boolean; notes: string; version: number; updated_at: string };
type ShoppingItem = { id: string; list_id: string; catalog_item_id: string | null; name: string; category: string; resource_cost: number; quantity: number; notes: string };
type ListTotals = { list_id: string; item_count: number; total_quantity: number; total_resource_cost: number; highest_resource_cost: number };

export type ShoppingSummary = { itemCount: number; totalQuantity: number; totalCost: number; highestCost: number; aboveResources: number };

/** Mirrors the character_shopping_list_totals view, plus the items priced above the sheet's Resources. */
export function summarizeShoppingItems(items: readonly Pick<ShoppingItem, "resource_cost" | "quantity">[], resources: number | null): ShoppingSummary {
  return items.reduce<ShoppingSummary>((total, item) => ({
    itemCount: total.itemCount + 1,
    totalQuantity: total.totalQuantity + item.quantity,
    totalCost: total.totalCost + item.resource_cost * item.quantity,
    highestCost: Math.max(total.highestCost, item.resource_cost),
    aboveResources: total.aboveResources + (resources !== null && item.resource_cost > resources ? 1 : 0),
  }), { itemCount: 0, totalQuantity: 0, totalCost: 0, highestCost: 0, aboveResources: 0 });
}

export function orderCatalogByFavorites(items: readonly AtlasEquipment[], favorites: readonly string[]): AtlasEquipment[] {
  const favoriteSet = new Set(favorites);
  return [...items].sort((left, right) => Number(favoriteSet.has(right.id)) - Number(favoriteSet.has(left.id)) || left.name.localeCompare(right.name, "pt-BR"));
}

export function CharacterShoppingLists({ campaignId, sheetId, canEdit, resources, favorites }: {
  campaignId: string; sheetId: string; canEdit: boolean; resources: number | null; favorites: readonly string[];
}) {
  const selected = useRef(sheetId); selected.current = sheetId;
  const [userId, setUserId] = useState<string | null>(null);
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [totals, setTotals] = useState<ListTotals[]>([]);
  const [activeId, setActiveId] = useState("");
  const [newName, setNewName] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const client = createClient();
        const [{ data: auth }, listsResult, totalsResult] = await Promise.all([
          client.auth.getUser(),
          client.from("character_shopping_lists").select("id,name,owner_id,shared_with_master,notes,version,updated_at").eq("sheet_id", sheetId).eq("campaign_id", campaignId).order("created_at"),
          client.from("character_shopping_list_totals").select("*").eq("sheet_id", sheetId).eq("campaign_id", campaignId),
        ]);
        if (!active || selected.current !== sheetId) return;
        if (listsResult.error || totalsResult.error) throw new Error();
        const loaded = (listsResult.data ?? []) as ShoppingList[];
        setUserId(auth.user?.id ?? null);
        setLists(loaded);
        setTotals((totalsResult.data ?? []) as ListTotals[]);
        const ids = loaded.map((list) => list.id);
        const itemsResult = ids.length
          ? await client.from("character_shopping_list_items").select("id,list_id,catalog_item_id,name,category,resource_cost,quantity,notes").in("list_id", ids).order("sort_order").order("created_at")
          : { data: [], error: null };
        if (!active || selected.current !== sheetId) return;
        if (itemsResult.error) throw new Error();
        setItems((itemsResult.data ?? []) as ShoppingItem[]);
        setActiveId((current) => ids.includes(current) ? current : ids[0] ?? "");
      } catch {
        if (active) setMessage("Não foi possível carregar as listas de compras. Confira a migration de listas.");
      }
    })();
    return () => { active = false; };
  }, [campaignId, sheetId, revision]);

  async function run(operation: () => PromiseLike<{ error: unknown; data?: unknown }>, text: string) {
    setBusy(true); setMessage("");
    try {
      const { error, data } = await operation();
      if (error || (Array.isArray(data) && data.length === 0)) throw new Error("Conflito ou acesso recusado. Atualize as listas e tente de novo.");
      setRevision((value) => value + 1); setMessage(text);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar a lista.");
    } finally { setBusy(false); }
  }

  function createList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    void run(() => createClient().from("character_shopping_lists").insert({ sheet_id: sheetId, campaign_id: campaignId, name }).select("id"), "Lista criada.");
    setNewName("");
  }

  function addCatalogItem(event: FormEvent<HTMLFormElement>, list: ShoppingList) {
    event.preventDefault();
    const entry = ATLAS_EQUIPMENT.find((item) => item.id === catalogId);
    if (!entry || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) { setMessage("Escolha um item do arsenal e uma quantidade de 1 a 99."); return; }
    void run(() => createClient().from("character_shopping_list_items").insert({
      list_id: list.id, campaign_id: campaignId, catalog_item_id: entry.id, name: entry.name,
      category: entry.category, resource_cost: entry.resource_cost, quantity,
    }).select("id"), `${entry.name} adicionado à lista.`);
  }

  const active = lists.find((list) => list.id === activeId) ?? null;
  const activeItems = items.filter((item) => item.list_id === active?.id);
  const isAuthor = Boolean(active && userId && active.owner_id === userId);
  const summary = summarizeShoppingItems(activeItems, resources);
  const serverTotals = totals.find((total) => total.list_id === active?.id);
  const catalog = orderCatalogByFavorites(ATLAS_EQUIPMENT, favorites);
  const favoriteSet = new Set(favorites);

  return <article className="generation-card" aria-busy={busy}>
    <p className="eyebrow">LISTAS DE COMPRAS</p><h2>Planejamento de aquisições</h2>
    <p className="notice">Custos somam classificações de Recursos por quantidade; servem de referência para a conversa com o narrador.</p>
    {lists.length > 0 && <label>Lista<select value={activeId} onChange={(event) => setActiveId(event.target.value)}>
      {lists.map((list) => <option key={list.id} value={list.id}>{list.name}{list.owner_id !== userId ? " (de jogador)" : ""}{list.shared_with_master ? " · compartilhada" : ""}</option>)}
    </select></label>}
    {active && <>
      <p><b>{summary.itemCount}</b> itens · <b>{summary.totalQuantity}</b> unidades · custo total <b>{serverTotals?.total_resource_cost ?? summary.totalCost}</b> em Recursos · maior custo <b>{serverTotals?.highest_resource_cost ?? summary.highestCost}</b></p>
      {resources !== null && summary.aboveResources > 0 && <p className="notice">{summary.aboveResources} item(ns) acima de Recursos {resources} da ficha.</p>}
      <ul className="inventory-items">{activeItems.map((item) => <li className="inventory-item" key={item.id}>
        <b>{item.name}</b> · {item.quantity}× · Recursos {item.resource_cost} (subtotal {item.resource_cost * item.quantity})
        {isAuthor && canEdit && <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => createClient().from("character_shopping_list_items").delete().eq("id", item.id).select("id"), "Item removido da lista.")}>Remover {item.name}</button>}
      </li>)}</ul>
      {activeItems.length === 0 && <p>Lista vazia.</p>}
      {isAuthor && canEdit && <>
        <form className="inventory-form" onSubmit={(event) => addCatalogItem(event, active)}>
          <label>Item do arsenal<select value={catalogId} onChange={(event) => setCatalogId(event.target.value)}>
            <option value="">Escolha</option>
            {catalog.map((item) => <option key={item.id} value={item.id}>{favoriteSet.has(item.id) ? "★ " : ""}{item.name} · Recursos {item.resource_cost}</option>)}
          </select></label>
          <label>Quantidade<input type="number" min={1} max={99} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          <button type="submit" className="quiet" disabled={busy}>Adicionar à lista</button>
        </form>
        <div className="actions">
          <label className="inline-check"><input type="checkbox" checked={active.shared_with_master} disabled={busy} onChange={(event) => void run(() => createClient().from("character_shopping_lists").update({ shared_with_master: event.target.checked }).eq("id", active.id).eq("version", active.version).select("id"), event.target.checked ? "Lista compartilhada com o narrador." : "Lista voltou a ser privada.")} />Compartilhar com o narrador</label>
          <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => createClient().from("character_shopping_lists").delete().eq("id", active.id).eq("version", active.version).select("id"), "Lista excluída.")}>Excluir lista</button>
        </div>
      </>}
    </>}
    {canEdit && <form className="inventory-form" onSubmit={createList}>
      <label>Nova lista<input value={newName} maxLength={120} onChange={(event) => setNewName(event.target.value)} /></label>
      <button type="submit" className="quiet" disabled={busy || !newName.trim()}>Criar lista</button>
    </form>}
    <p role="status" aria-live="polite">{message}</p>
  </article>;
}
