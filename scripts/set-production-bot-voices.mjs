import { pathToFileURL } from "node:url";

const account = "da53b4cd888030bba791621ea1a39f8c";
const database = "240c0754-3fc2-4da9-8d6e-72df75faa3a1";
const profiles = {
  adult: 1,
  "isaac-advanced": 1,
  "isaac-basic": 2,
  "isaac-translator": 1,
  sales: 1,
  student: 2,
  "voice-navigator": 3,
  "waze-770": 1,
};

export async function setProductionBotVoices(query, report = console.log) {
  const ids = Object.keys(profiles);
  const rows = await query(`SELECT b.id, b.active_version, p.settings_json, p.updated_at,
      json_extract(p.settings_json, '$.voice') AS voice,
      json_set(p.settings_json, '$.voice', 'Puck') AS new_settings,
      json_extract(old.settings_json, '$.voice') AS prior_voice,
      next.settings_json AS next_settings, next.created_at AS staged_at
    FROM bots b
    JOIN tutor_profile_settings p ON p.profile_id=b.id
    JOIN bot_versions old ON old.bot_id=b.id AND old.version=b.active_version
    LEFT JOIN bot_versions next ON next.bot_id=b.id AND next.version=b.active_version+1
    WHERE b.id IN (${ids.map(() => "?").join(",")}) ORDER BY b.id`, ids);
  const pending = ids.flatMap(id => {
    const row = rows.find(r => r.id === id);
    const prior = profiles[id];
    if (row?.active_version === prior + 1 && row.voice === "Puck" && row.prior_voice === "Puck") return [];
    if (row?.active_version === prior && row.prior_voice === "Aoede" && (
      (row.voice === "Aoede" && (!row.staged_at || row.next_settings === row.new_settings)) ||
      (row.voice === "Puck" && row.next_settings === row.settings_json && row.staged_at === row.updated_at)
    )) return [row];
    throw new Error(`Unexpected voice or version for ${id}; no writes made in this run.`);
  });
  for (const row of pending) {
    const { id, active_version: prior } = row;
    const version = prior + 1;
    const at = row.staged_at || new Date().toISOString();
    if (!row.staged_at) {
      await write(id, "insert version", `INSERT INTO bot_versions (bot_id,version,settings_json,created_at)
        SELECT b.id,?,?,? FROM bots b JOIN tutor_profile_settings p ON p.profile_id=b.id
        WHERE b.id=? AND b.active_version=? AND p.settings_json=? AND p.updated_at=?
        RETURNING version`, [version, row.new_settings, at, id, prior, row.settings_json, row.updated_at]);
    }
    if (row.voice !== "Puck") {
      await write(id, "save settings", `UPDATE tutor_profile_settings SET settings_json=?,updated_at=?
        WHERE profile_id=? AND settings_json=? AND updated_at=?
          AND EXISTS (SELECT 1 FROM bots WHERE id=? AND active_version=?)
        RETURNING profile_id`, [row.new_settings, at, id, row.settings_json, row.updated_at, id, prior]);
    }
    await write(id, "activate version", `UPDATE bots SET active_version=?,updated_at=?
      WHERE id=? AND active_version=? AND EXISTS (
        SELECT 1 FROM tutor_profile_settings p JOIN bot_versions v ON v.bot_id=p.profile_id
        WHERE p.profile_id=? AND v.version=? AND p.settings_json=v.settings_json AND p.updated_at=v.created_at
      ) RETURNING id`, [version, at, id, prior, id, version]);
    report(`${id}: Aoede → Puck (version ${version})`);
  }
  report(`Updated ${pending.length} of ${ids.length} bots.`);

  async function write(id, action, sql, params) {
    if ((await query(sql, params)).length !== 1) throw new Error(`${id}: could not ${action}; stopped.`);
  }
}

async function main() {
  if (process.argv.slice(2).join(" ") !== "--apply") {
    console.log("No writes made. After merge, pause bot settings edits, set CLOUDFLARE_API_TOKEN in the environment, and run:");
    console.log("node scripts/set-production-bot-voices.mjs --apply");
    return;
  }
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("Set CLOUDFLARE_API_TOKEN in the environment.");
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}/query`;
  await setProductionBotVoices(async (sql, params) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || !data.success || !data.result?.[0]?.success) {
      throw new Error(`D1 request failed (HTTP ${response.status}, code ${data.errors?.[0]?.code ?? "unknown"}).`);
    }
    return data.result[0].results;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
