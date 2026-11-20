import assert from "node:assert/strict";
import test from "node:test";

import { currentPositionMs, followPlayPayload, isValidSpotifyUri, nowPlayingFromPlayer, parseSpotifyUri, playlistUriFromId } from "../lib/spotify-sync.ts";

const ID = "37i9dQZF1DXcBWIGoYBM5M";

test("parseSpotifyUri accepts URIs and open.spotify.com links", () => {
  assert.deepEqual(parseSpotifyUri(`spotify:playlist:${ID}`), { kind: "playlist", id: ID, uri: `spotify:playlist:${ID}` });
  assert.equal(parseSpotifyUri(`https://open.spotify.com/track/${ID}`)?.uri, `spotify:track:${ID}`);
  assert.equal(parseSpotifyUri(`https://open.spotify.com/intl-pt/album/${ID}`)?.uri, `spotify:album:${ID}`);
  assert.equal(parseSpotifyUri(`http://open.spotify.com/track/${ID}`), null);
  assert.equal(parseSpotifyUri(`https://evil.example/track/${ID}`), null);
  assert.equal(parseSpotifyUri("spotify:track:short"), null);
});

test("isValidSpotifyUri respects kinds", () => {
  assert.equal(isValidSpotifyUri(`spotify:track:${ID}`, ["track"]), true);
  assert.equal(isValidSpotifyUri(`spotify:track:${ID}`, ["playlist", "album"]), false);
  assert.equal(isValidSpotifyUri(`spotify:artist:${ID}`), false);
});

test("playlistUriFromId validates the id", () => {
  assert.equal(playlistUriFromId(ID), `spotify:playlist:${ID}`);
  assert.equal(playlistUriFromId("x"), null);
});

test("currentPositionMs adds elapsed time only while playing and clamps", () => {
  const started = "2026-01-01T00:00:00.000Z";
  const now = Date.parse(started) + 5000;
  assert.equal(currentPositionMs({ position_ms: 1000, is_playing: true, started_at: started }, now), 6000);
  assert.equal(currentPositionMs({ position_ms: 1000, is_playing: false, started_at: started }, now), 1000);
  assert.equal(currentPositionMs({ position_ms: 0, is_playing: true, started_at: started }, now - 9000), 0);
});

test("followPlayPayload builds context or track payloads", () => {
  const base = { position_ms: 2000, is_playing: false, started_at: null, track_name: null };
  assert.deepEqual(
    followPlayPayload({ ...base, context_uri: `spotify:playlist:${ID}`, track_uri: `spotify:track:${ID}` }, 0),
    { context_uri: `spotify:playlist:${ID}`, offset_uri: `spotify:track:${ID}`, position_ms: 2000 },
  );
  assert.deepEqual(followPlayPayload({ ...base, context_uri: `spotify:playlist:${ID}`, track_uri: null }, 0), { context_uri: `spotify:playlist:${ID}`, position_ms: 2000 });
  assert.deepEqual(followPlayPayload({ ...base, context_uri: null, track_uri: `spotify:track:${ID}` }, 0), { uris: [`spotify:track:${ID}`], position_ms: 2000 });
  assert.equal(followPlayPayload({ ...base, context_uri: null, track_uri: null }, 0), null);
});

test("nowPlayingFromPlayer maps the player and drops unsupported contexts", () => {
  const out = nowPlayingFromPlayer({
    is_playing: true, progress_ms: 1234,
    item: { name: "Faixa", artists: ["A", "B"], url: `https://open.spotify.com/track/${ID}` },
    context_uri: `spotify:artist:${ID}`,
  }, 0);
  assert.equal(out.context_uri, null);
  assert.equal(out.track_uri, `spotify:track:${ID}`);
  assert.equal(out.track_name, "Faixa · A, B");
  assert.equal(out.position_ms, 1234);
  assert.equal(nowPlayingFromPlayer(null, 0).is_playing, false);
});

