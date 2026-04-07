export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { target_date, schedule_id } = req.body;
  if (!target_date) return res.status(400).json({ error: 'target_date is required' });

  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
  };

  async function sbGet(path) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
    return r.json();
  }
  async function sbPatch(path, body) {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: 'PATCH', headers, body: JSON.stringify(body)
    });
  }
  async function sbPost(path, body) {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      method: 'POST', headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify(body)
    });
  }
  async function sbDelete(path) {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'DELETE', headers });
  }

  try {
    // データ取得
    const [pendingRes, confirmedRes, spotsRes, usersRes] = await Promise.all([
      sbGet(`reservations?status=eq.pending&date=eq.${target_date}&select=*`),
      sbGet(`reservations?status=eq.confirmed&date=eq.${target_date}&select=*`),
      sbGet(`spots?select=id,name`),
      sbGet(`users?select=id,election_type`)
    ]);

    const pending = Array.isArray(pendingRes) ? pendingRes : [];
    const confirmed = Array.isArray(confirmedRes) ? confirmedRes : [];
    const spots = Array.isArray(spotsRes) ? spotsRes : [];
    const users = Array.isArray(usersRes) ? usersRes : [];

    if (pending.length === 0) {
      if (schedule_id) await sbPatch(`lottery_schedules?id=eq.${schedule_id}`, { status: 'done' });
      return res.status(200).json({ results: [], message: '抽選対象なし' });
    }

    // 抽選実行
    const results = [];
    const done = new Set();
    const takenSlots = new Set(
      confirmed.filter(r => r.assigned_spot_id && r.time_slot)
        .map(r => `${r.assigned_spot_id}_${r.date}_${r.time_slot}`)
    );
    const candWon = new Set();
    const candSlotKey = (cid, d, ts) => `${String(cid)}_${d}_${ts}`;

    const typeWeight = r => {
      const u = users.find(x => String(x.id) === String(r.cand_id));
      const t = u?.election_type || '';
      return (t === 'single' || t === 'single_double') ? 0 : 1;
    };

    // 第1〜3希望のラウンド処理
    for (let prefIdx = 0; prefIdx < 3; prefIdx++) {
      const remaining = pending.filter(r => {
        if (done.has(r.id)) return false;
        const prefs = Array.isArray(r.spot_prefs) ? r.spot_prefs : [];
        const sid = prefs[prefIdx];
        return sid != null && sid !== '';
      });

      const groups = {};
      remaining.forEach(r => {
        const spotId = String(r.spot_prefs[prefIdx]);
        const k = `${spotId}_${r.date}_${r.time_slot || ''}`;
        (groups[k] = groups[k] || []).push(r);
      });

      for (const [key, entries] of Object.entries(groups)) {
        const firstUnder = key.indexOf('_');
        const secondUnder = key.indexOf('_', firstUnder + 1);
        const spotId = key.slice(0, firstUnder);
        const date = key.slice(firstUnder + 1, secondUnder);
        const timeSlot = key.slice(secondUnder + 1);
        const slotKey = `${spotId}_${date}_${timeSlot}`;
        const spotName = spots.find(s => String(s.id) === spotId)?.name || '—';

        if (takenSlots.has(slotKey)) continue;

        const uniq = entries.filter(e =>
          !done.has(e.id) && !candWon.has(candSlotKey(e.cand_id, date, timeSlot))
        );
        if (uniq.length === 0) continue;

        let winner;
        if (uniq.length === 1) {
          winner = uniq[0];
        } else {
          const minWeight = Math.min(...uniq.map(typeWeight));
          const eligible = uniq.filter(r => typeWeight(r) === minWeight);
          // サーバー側でのランダム選択
          const idx = Math.floor(Math.random() * eligible.length);
          winner = eligible[idx];
        }

        winner.assigned_spot_id = spotId;
        winner.assigned = timeSlot;
        winner.status = 'confirmed';
        done.add(winner.id);
        takenSlots.add(slotKey);
        candWon.add(candSlotKey(winner.cand_id, date, timeSlot));

        results.push({
          reservationId: winner.id,
          candId: winner.cand_id,
          name: winner.name,
          party: winner.party,
          timeSlot,
          date,
          spotId,
          spotName,
          result: 'win',
          pref: `第${prefIdx + 1}希望`
        });

        // 落選者
        uniq.filter(e => e.id !== winner.id).forEach(loser => {
          results.push({
            reservationId: loser.id,
            candId: loser.cand_id,
            name: loser.name,
            party: loser.party,
            timeSlot,
            date,
            spotId,
            spotName,
            result: 'lose_round',
            pref: `第${prefIdx + 1}希望（次ラウンドへ）`
          });
        });
      }
    }

    // 全ラウンド後の残り
    const stillPending = pending.filter(r => !done.has(r.id));
    for (const r of stillPending) {
      const prefs = Array.isArray(r.spot_prefs) ? r.spot_prefs.filter(s => s != null && s !== '') : [];
      const candKey = candSlotKey(r.cand_id, r.date, r.time_slot || '');

      if (prefs.length === 0) {
        if (candWon.has(candKey)) {
          r.status = 'no_slot';
          results.push({ reservationId: r.id, name: r.name, party: r.party, timeSlot: r.time_slot || '—', date: r.date, spotName: '—', result: 'lose', pref: '（希望場所未設定）' });
          done.add(r.id);
          continue;
        }
        const freeSpot = spots.find(s => !takenSlots.has(`${s.id}_${r.date}_${r.time_slot}`));
        if (freeSpot) {
          r.assigned_spot_id = freeSpot.id; r.assigned = r.time_slot; r.status = 'confirmed';
          done.add(r.id); takenSlots.add(`${freeSpot.id}_${r.date}_${r.time_slot}`); candWon.add(candKey);
          results.push({ reservationId: r.id, name: r.name, party: r.party, timeSlot: r.time_slot, date: r.date, spotId: freeSpot.id, spotName: freeSpot.name, result: 'win', pref: '（自動割当）' });
        } else {
          r.status = 'no_slot';
          results.push({ reservationId: r.id, name: r.name, party: r.party, timeSlot: r.time_slot || '—', date: r.date, spotName: '—', result: 'lose', pref: '（希望場所未設定・空きなし）' });
          done.add(r.id);
        }
      } else {
        r.status = 'no_slot';
        const spotName = spots.find(s => String(s.id) === String(prefs[0]))?.name || '—';
        results.push({ reservationId: r.id, name: r.name, party: r.party, timeSlot: r.time_slot || '—', date: r.date, spotName, result: 'lose', pref: '—' });
        done.add(r.id);
      }
    }

    // DB更新：当選
    const winners = pending.filter(r => r.status === 'confirmed');
    const losers = pending.filter(r => r.status === 'no_slot');

    for (const w of winners) {
      await sbPatch(`reservations?id=eq.${w.id}`, {
        status: 'confirmed',
        assigned_spot_id: w.assigned_spot_id,
        assigned: w.assigned
      });
    }
    for (const l of losers) {
      await sbDelete(`reservations?id=eq.${l.id}`);
    }

    // lottery_logsに記録
    const logEntries = results
      .filter(r => r.result === 'win' || r.result === 'lose')
      .map(r => ({
        target_date,
        spot_id: r.spotId || null,
        time_slot: r.timeSlot,
        candidates: pending.filter(p =>
          p.time_slot === r.timeSlot &&
          Array.isArray(p.spot_prefs) &&
          p.spot_prefs.some(sp => String(sp) === String(r.spotId))
        ).map(p => ({ id: p.cand_id, name: p.name, party: p.party })),
        winner_id: r.result === 'win' ? r.candId : null
      }));

    if (logEntries.length > 0) {
      await sbPost('lottery_logs', logEntries);
    }

    // スケジュールをdoneに
    if (schedule_id) {
      await sbPatch(`lottery_schedules?id=eq.${schedule_id}`, { status: 'done' });
    }

    return res.status(200).json({ results, winners: winners.length, losers: losers.length });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
