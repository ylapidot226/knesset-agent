/**
 * Knesset data fetcher — OData v4 only.
 * BASE: https://knesset.gov.il/OdataV4/ParliamentInfo
 *
 * Verified entities and field names (tested 2026-05-17):
 *   KNS_PlenumVote        Id, VoteDateTime, VoteTitle, VoteSubject, VoteStatusCode
 *   KNS_PlenumVoteResult  Id, MkId, VoteID, VoteDate, ResultCode, ResultDesc, LastName, FirstName
 *                         ResultDesc values: "בעד" / "נגד" / "נמנע" / "נוכח" / "קיזוז"
 *   KNS_PlenumSession     Id, Number, KnessetNum, Name, StartDate, FinishDate
 *   KNS_PlmSessionItem    Id, PlenumSessionID, Name, ItemTypeDesc, Ordinal, IsDiscussion
 *   KNS_Committee         Id, Name, KnessetNum, CommitteeTypeID, CommitteeTypeDesc, IsCurrent
 *                         CommitteeTypeID 71 = ועדה ראשית (16 committees in knesset 25)
 *   KNS_CommitteeSession  Id, CommitteeID, StartDate, StatusID, StatusDesc, Number
 *                         StatusID 193 = מבוטלת
 *   KNS_Person            Id, FirstName, LastName, GenderDesc, Email, IsCurrent
 *   KNS_PersonToPosition  Id, PersonID, PositionID, KnessetNum, FactionName, FinishDate, IsCurrent
 *                         PositionID 43=ח"כ, 61=ח"כית, 54=חבר סיעה (has FactionName)
 *   KNS_Query             Id, Number, KnessetNum, Name, TypeDesc, PersonID, SubmitDate, ReplyMinisterDate
 *   KNS_Bill              Id, KnessetNum, Name, SubTypeDesc, StatusID, LastUpdatedDate
 *   KNS_BillInitiator     Id, BillID, PersonID, IsInitiator
 *   KNS_Agenda            Id, KnessetNum, Name, SubTypeDesc, InitiatorPersonID
 *
 * NOT available: KNS_Presence, Twitter handles
 */

const axios = require('axios');

const BASE         = 'https://knesset.gov.il/OdataV4/ParliamentInfo';
const KNESSET_NUM  = 25;
const MK_TOTAL     = 120;

// ── Generic OData helper ──────────────────────────────────────────────────

async function odata(entity, qs = '') {
  const url = `${BASE}/${entity}?${qs}${qs ? '&' : ''}$format=json`;
  const endpoint = `${BASE}/${entity}`;
  try {
    const resp = await axios.get(url, {
      headers: { Accept: 'application/json' },
      timeout: 25000,
    });
    const rows = resp.data?.value ?? [];
    console.log(`[knesset] GET ${entity} → ${rows.length} רשומות`);
    return { data: rows, endpoint, hasData: rows.length > 0 };
  } catch (e) {
    console.error(`[knesset] ERROR ${entity} — ${e.message}`);
    return { data: [], endpoint, hasData: false, error: e.message };
  }
}

function noData(reason, endpoint) {
  console.log(`[knesset] אין נתונים — ${reason}`);
  return { hasData: false, reason, endpoint };
}

function isoAgo(days = 0, hours = 0) {
  return new Date(Date.now() - (days * 86400 + hours * 3600) * 1000)
    .toISOString()
    .replace('.000Z', 'Z');
}

// ═══════════════════════════════════════════════════════════════════════════
// Core API functions (per spec)
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. getRecentVotes — הצבעות 48 שעות אחרונות ───────────────────────────

async function getRecentVotes() {
  const since = isoAgo(0, 48);
  const qs = `$filter=VoteDateTime gt ${since}&$orderby=Id desc&$top=20&$select=Id,VoteDateTime,VoteTitle,VoteSubject`;
  const { data, endpoint, error } = await odata('KNS_PlenumVote', qs);

  if (error) return noData(`שגיאה בשליפת הצבעות: ${error}`, endpoint);
  if (!data.length) return noData('אין הצבעות ב-48 שעות האחרונות', endpoint);

  return {
    hasData: true,
    endpoint,
    votes: data.map((r) => ({
      id:       r.Id,
      date:     r.VoteDateTime?.slice(0, 16).replace('T', ' '),
      title:    r.VoteTitle ?? '',
      subject:  r.VoteSubject ?? '',
    })),
  };
}

// ── 2. getVoteResults — תוצאות הצבעה ספציפית ─────────────────────────────

async function getVoteResults(voteId) {
  const qs = `$filter=VoteID eq ${voteId}&$orderby=Id`;
  const { data, endpoint, error } = await odata('KNS_PlenumVoteResult', qs);

  if (error) return noData(`שגיאה בשליפת תוצאות הצבעה ${voteId}: ${error}`, endpoint);
  if (!data.length) return noData(`אין תוצאות להצבעה ${voteId}`, endpoint);

  const counts = { בעד: 0, נגד: 0, נמנע: 0, נוכח: 0, קיזוז: 0, אחר: 0 };
  for (const r of data) {
    const key = r.ResultDesc ?? 'אחר';
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return {
    hasData: true,
    endpoint,
    voteId,
    total: data.length,
    counts,
    rows: data,
  };
}

// ── 3. getSwaps — קיזוזים ─────────────────────────────────────────────────

async function getSwaps(voteId) {
  const results = await getVoteResults(voteId);
  if (!results.hasData) return results;

  const swaps = results.rows
    .filter((r) => r.ResultDesc === 'קיזוז')
    .map((r) => ({ mkId: r.MkId, name: `${r.FirstName ?? ''} ${r.LastName ?? ''}`.trim() }));

  if (!swaps.length) return noData(`אין קיזוזים בהצבעה ${voteId}`, results.endpoint);

  return { hasData: true, endpoint: results.endpoint, voteId, swaps };
}

// ── 4. getAbsences — היעדרויות ────────────────────────────────────────────

async function getAbsences(voteId) {
  const results = await getVoteResults(voteId);
  if (!results.hasData) return results;

  const present = results.total;
  const absent  = MK_TOTAL - present;

  return {
    hasData: true,
    endpoint: results.endpoint,
    voteId,
    present,
    absent,
    absentPct: Math.round((absent / MK_TOTAL) * 100),
  };
}

// ── 5. getRecentSessions — ישיבות מליאה אחרונות ──────────────────────────

async function getRecentSessions() {
  const { data: sessions, endpoint, error } = await odata(
    'KNS_PlenumSession',
    `$filter=KnessetNum eq ${KNESSET_NUM}&$orderby=Id desc&$top=5`
  );

  if (error) return noData(`שגיאה בשליפת ישיבות מליאה: ${error}`, endpoint);
  if (!sessions.length) return noData('אין ישיבות מליאה', endpoint);

  // Fetch agenda items (IsDiscussion eq 1) for each session
  const sessionIds = sessions.map((s) => s.Id);
  const agendaFilter = encodeURIComponent(
    `(${sessionIds.map((id) => `PlenumSessionID eq ${id}`).join(' or ')}) and IsDiscussion eq 1`
  );
  const { data: agendaRows } = await odata(
    'KNS_PlmSessionItem',
    `$filter=${agendaFilter}&$orderby=Ordinal&$select=PlenumSessionID,Name,ItemTypeDesc,Ordinal`
  );

  const agendaBySession = {};
  for (const row of agendaRows) {
    agendaBySession[row.PlenumSessionID] = agendaBySession[row.PlenumSessionID] ?? [];
    agendaBySession[row.PlenumSessionID].push(`${row.ItemTypeDesc}: ${row.Name}`);
  }

  return {
    hasData: true,
    endpoint,
    sessions: sessions.map((s) => ({
      id:     s.Id,
      number: s.Number,
      date:   s.StartDate?.slice(0, 10),
      name:   s.Name,
      agenda: agendaBySession[s.Id] ?? [],
    })),
  };
}

// ── 6. getCommitteeSessions — ישיבות ועדות ראשיות ─────────────────────────

async function getCommitteeSessions(days = 7) {
  // Step 1: get main committees (CommitteeTypeID 71)
  const { data: committees, endpoint: cmtEp, error: cmtErr } = await odata(
    'KNS_Committee',
    `$filter=${encodeURIComponent(`KnessetNum eq ${KNESSET_NUM} and CommitteeTypeID eq 71 and IsCurrent eq true`)}&$orderby=Name&$select=Id,Name`
  );

  if (cmtErr) return noData(`שגיאה בשליפת ועדות: ${cmtErr}`, cmtEp);
  if (!committees.length) return noData('אין ועדות ראשיות', cmtEp);

  const committeeIds = committees.map((c) => c.Id);
  const nameById     = Object.fromEntries(committees.map((c) => [c.Id, c.Name]));

  // Step 2: get their sessions (last N days, non-cancelled, not in the future)
  const since = isoAgo(days);
  const now   = new Date().toISOString().replace('.000Z', 'Z');
  const idFilter = committeeIds.map((id) => `CommitteeID eq ${id}`).join(' or ');
  const filter = encodeURIComponent(
    `(${idFilter}) and StartDate gt ${since} and StartDate le ${now} and StatusID ne 193`
  );
  const { data: sessions, endpoint: sessEp, error: sessErr } = await odata(
    'KNS_CommitteeSession',
    `$filter=${filter}&$orderby=Number&$select=Id,CommitteeID,StartDate,Number,StatusDesc`
  );

  if (sessErr) return noData(`שגיאה בשליפת ישיבות ועדות: ${sessErr}`, sessEp);
  if (!sessions.length) return noData(`אין ישיבות ועדות ב-${days} הימים האחרונים`, sessEp);

  return {
    hasData: true,
    endpoint: sessEp,
    sessions: sessions.map((s) => ({
      id:        s.Id,
      committee: nameById[s.CommitteeID] ?? `ועדה ${s.CommitteeID}`,
      date:      s.StartDate?.slice(0, 10),
      number:    s.Number ?? null,   // null for future/unassigned sessions
    })),
  };
}

// ── 7. getCurrentMembers — כל 120 חכ"מ פעילים ────────────────────────────

async function getCurrentMembers() {
  const { data, endpoint, error } = await odata(
    'KNS_PersonToPosition',
    `$filter=${encodeURIComponent(`PositionID in (43,61) and FinishDate eq null and KnessetNum eq ${KNESSET_NUM}`)}&$expand=KNS_Person&$select=PersonID,PositionID,KNS_Person`
  );

  if (error) return noData(`שגיאה בשליפת חברי כנסת: ${error}`, endpoint);
  if (!data.length) return noData('אין חברי כנסת פעילים', endpoint);

  const members = data
    .filter((r) => r.KNS_Person)
    .map((r) => ({
      personId:  r.PersonID,
      firstName: r.KNS_Person.FirstName,
      lastName:  r.KNS_Person.LastName,
      gender:    r.KNS_Person.GenderDesc,
      email:     r.KNS_Person.Email,
    }));

  return { hasData: true, endpoint, total: members.length, members };
}

// ── 8. getMemberQueries — שאילתות של חכ"מ ספציפי ─────────────────────────

async function getMemberQueries(personId) {
  const { data, endpoint, error } = await odata(
    'KNS_Query',
    `$filter=${encodeURIComponent(`PersonID eq ${personId} and KnessetNum eq ${KNESSET_NUM}`)}&$orderby=Id desc&$top=20&$select=Id,Name,TypeDesc,SubmitDate,ReplyMinisterDate`
  );

  if (error) return noData(`שגיאה בשליפת שאילתות PersonID=${personId}: ${error}`, endpoint);
  if (!data.length) return noData(`אין שאילתות לח"כ ${personId} בכנסת ${KNESSET_NUM}`, endpoint);

  return {
    hasData: true,
    endpoint,
    personId,
    queries: data.map((r) => ({
      id:          r.Id,
      name:        r.Name,
      type:        r.TypeDesc,
      submitDate:  r.SubmitDate?.slice(0, 10),
      replyDate:   r.ReplyMinisterDate?.slice(0, 10) ?? null,
    })),
  };
}

// ── 9. getMemberBills — הצעות חוק של חכ"מ ספציפי ─────────────────────────

async function getMemberBills(personId) {
  // Step 1: get bill IDs this MK initiated
  const { data: initRows, endpoint: initEp, error: initErr } = await odata(
    'KNS_BillInitiator',
    `$filter=${encodeURIComponent(`PersonID eq ${personId} and IsInitiator eq true`)}&$select=BillID&$top=30`
  );

  if (initErr) return noData(`שגיאה בשליפת BillInitiator PersonID=${personId}: ${initErr}`, initEp);
  if (!initRows.length) return noData(`אין הצעות חוק לח"כ ${personId}`, initEp);

  // Step 2: get bill details (up to 5 at a time to avoid URL length limit)
  const billIds = initRows.slice(0, 5).map((r) => r.BillID);
  const billFilter = encodeURIComponent(
    billIds.map((id) => `Id eq ${id}`).join(' or ')
  );
  const { data: bills, endpoint: billEp } = await odata(
    'KNS_Bill',
    `$filter=${billFilter}&$select=Id,Name,SubTypeDesc,StatusID,LastUpdatedDate`
  );

  return {
    hasData: true,
    endpoint: billEp,
    personId,
    totalInitiated: initRows.length,
    bills: bills.map((b) => ({
      id:        b.Id,
      name:      b.Name,
      type:      b.SubTypeDesc,
      updatedAt: b.LastUpdatedDate?.slice(0, 10),
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Compound functions (build rawSummary for AI)
// ═══════════════════════════════════════════════════════════════════════════

async function fetchRecentActivity() {
  console.log('[knesset] מתחיל שליפה מ-OdataV4...');
  const usedEndpoints = new Set();
  const lines = [];

  // Votes
  const votesResult = await getRecentVotes();
  usedEndpoints.add(votesResult.endpoint);

  if (votesResult.hasData) {
    lines.push(`=== הצבעות (48 שעות אחרונות) | ${votesResult.endpoint} ===`);
    for (const v of votesResult.votes) {
      lines.push(`• [ID:${v.id}] ${v.date} — ${v.title}${v.subject ? ' | ' + v.subject : ''}`);

      const results = await getVoteResults(v.id);
      usedEndpoints.add(results.endpoint);
      if (results.hasData) {
        const c = results.counts;
        lines.push(
          `  בעד: ${c.בעד} | נגד: ${c.נגד} | נמנע: ${c.נמנע || 0} | ` +
          `נוכח: ${c.נוכח || 0} | קיזוז: ${c.קיזוז || 0} | ` +
          `נעדרים: ${MK_TOTAL - results.total}`
        );
      }
    }
  }
  // (no "no votes" message — keep rawSummary positive)

  // Committee sessions
  const cmtResult = await getCommitteeSessions(7);
  usedEndpoints.add(cmtResult.endpoint);
  if (cmtResult.hasData) {
    lines.push('');
    lines.push(`=== ישיבות ועדות ראשיות (7 ימים) | ${cmtResult.endpoint} ===`);
    for (const s of cmtResult.sessions.slice(0, 20)) {
      const numStr = s.number ? ` (ישיבה ${s.number})` : '';
      lines.push(`• [ID:${s.id}] ${s.date} — ${s.committee}${numStr}`);
    }
  } else {
    lines.push(`\n[ועדות] ${cmtResult.reason}`);
  }

  // Plenary sessions
  const sessResult = await getRecentSessions();
  usedEndpoints.add(sessResult.endpoint);
  if (sessResult.hasData) {
    lines.push('');
    lines.push(`=== ישיבות מליאה | ${sessResult.endpoint} ===`);
    for (const s of sessResult.sessions) {
      lines.push(`• ${s.date} — ישיבה ${s.number}${s.name ? ': ' + s.name : ''}`);
      if (s.agenda.length) lines.push(`  סדר יום: ${s.agenda.slice(0, 3).join(' | ')}`);
    }
  } else {
    lines.push(`\n[מליאה] ${sessResult.reason}`);
  }

  // Recent queries
  const { data: queryRows, endpoint: qEp } = await odata(
    'KNS_Query',
    `$filter=${encodeURIComponent(`KnessetNum eq ${KNESSET_NUM}`)}&$orderby=Id desc&$top=20&$select=Id,Name,TypeDesc,PersonID,SubmitDate`
  );
  usedEndpoints.add(qEp);
  if (queryRows.length) {
    // Enrich with MK names
    const personIds = [...new Set(queryRows.map((q) => q.PersonID).filter(Boolean))];
    const nameMap   = personIds.length ? await fetchPersonNames(personIds) : {};
    lines.push('');
    lines.push(`=== שאילתות אחרונות | ${qEp} ===`);

    // Per-MK counts (useful for tweet facts)
    const countByMk = {};
    const countByDate = {};
    for (const q of queryRows) {
      const mk   = nameMap[q.PersonID] ?? `PersonID:${q.PersonID}`;
      const date = q.SubmitDate?.slice(0, 10) ?? '?';
      countByMk[mk]   = (countByMk[mk] || 0) + 1;
      countByDate[date] = (countByDate[date] || 0) + 1;
    }
    for (const [mk, count] of Object.entries(countByMk).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      lines.push(`  ${mk} הגיש ${count} שאילתות`);
    }
    lines.push(`  סה"כ שאילתות: ${queryRows.length}`);

    for (const q of queryRows.slice(0, 10)) {
      const mk = nameMap[q.PersonID] ?? `PersonID:${q.PersonID}`;
      lines.push(`• [ID:${q.Id}] ${q.SubmitDate?.slice(0, 10)} — ${mk}: "${q.Name}" (${q.TypeDesc})`);
    }
  }

  // Recent bills
  const { data: billRows, endpoint: billEp } = await odata(
    'KNS_Bill',
    `$filter=${encodeURIComponent(`KnessetNum eq ${KNESSET_NUM}`)}&$orderby=Id desc&$top=20&$select=Id,Name,SubTypeDesc,LastUpdatedDate`
  );
  usedEndpoints.add(billEp);
  if (billRows.length) {
    lines.push('');
    lines.push(`=== הצעות חוק אחרונות | ${billEp} ===`);
    for (const b of billRows.slice(0, 8)) {
      lines.push(`• [ID:${b.Id}] ${b.LastUpdatedDate?.slice(0, 10)} — ${b.Name} (${b.SubTypeDesc})`);
    }
  }

  if (lines.every((l) => l.startsWith('['))) {
    console.log('[knesset] אין נתונים מאף endpoint');
    return null;
  }

  const endpoints = [...usedEndpoints];
  const rawSummary = lines.join('\n');
  console.log('[knesset] endpoints:', endpoints.map((e) => e.split('/').pop()).join(', '));

  const votes         = votesResult.hasData ? votesResult.votes : [];
  const cmtSessions   = cmtResult.hasData ? cmtResult.sessions : [];
  const plmSessions   = sessResult.hasData ? sessResult.sessions : [];

  // Flat set of all valid IDs for tweet verification
  const validIds = new Set([
    ...votes.map((v) => v.id),
    ...cmtSessions.map((s) => s.id),
    ...plmSessions.map((s) => s.id),
    ...queryRows.map((q) => q.Id),
    ...billRows.map((b) => b.Id),
  ]);

  return {
    fetchedAt:         new Date().toISOString(),
    rawSummary,
    usedEndpoints:     endpoints,
    votes,
    committeeSessions: cmtSessions,
    plenumSessions:    plmSessions,
    validIds,
  };
}

// ── Member-specific activity ──────────────────────────────────────────────

async function findMemberActivity(memberName) {
  console.log('[knesset] מחפש ח"כ:', memberName);

  const person = await findPersonByName(memberName);
  if (!person) {
    console.log('[knesset] לא נמצא ח"כ:', memberName);
    return null;
  }

  const personId = person.Id;
  const fullName = `${person.FirstName} ${person.LastName}`;
  console.log(`[knesset] נמצא: ${fullName} (id: ${personId})`);

  // Faction
  const { data: posData } = await odata(
    'KNS_PersonToPosition',
    `$filter=${encodeURIComponent(`PersonID eq ${personId} and KnessetNum eq ${KNESSET_NUM} and IsCurrent eq true`)}&$select=FactionName,DutyDesc&$top=5`
  );
  const faction = posData.find((p) => p.FactionName)?.FactionName ?? null;

  // Votes
  const { data: voteRows, endpoint: vEp } = await odata(
    'KNS_PlenumVoteResult',
    `$filter=${encodeURIComponent(`MkId eq ${personId}`)}&$orderby=VoteID desc&$top=20&$select=VoteID,VoteDate,ResultCode,ResultDesc`
  );

  // Queries
  const queriesResult = await getMemberQueries(personId);

  // Bills
  const billsResult = await getMemberBills(personId);

  if (!voteRows.length && !queriesResult.hasData && !billsResult.hasData) return null;

  const vCounts = voteRows.reduce((acc, v) => {
    acc[v.ResultDesc] = (acc[v.ResultDesc] || 0) + 1;
    return acc;
  }, {});

  const lines = [
    `פעילות ח"כ ${fullName} (כנסת ${KNESSET_NUM})`,
    faction ? `סיעה: ${faction}` : '',
    '',
    `=== הצבעות אחרונות | ${vEp} ===`,
    ...voteRows.map((v) => `• ${v.VoteDate?.slice(0, 10)} — הצבעה ${v.VoteID}: ${v.ResultDesc}`),
    voteRows.length ? `סיכום: ${Object.entries(vCounts).map(([k, v]) => `${k}: ${v}`).join(' | ')}` : '',
  ];

  if (queriesResult.hasData) {
    lines.push('', `=== שאילתות | ${queriesResult.endpoint} ===`);
    for (const q of queriesResult.queries.slice(0, 10)) {
      lines.push(`• ${q.submitDate} — "${q.name}" (${q.type})`);
    }
  }

  if (billsResult.hasData) {
    lines.push('', `=== הצעות חוק | ${billsResult.endpoint} ===`);
    lines.push(`סה"כ יזם: ${billsResult.totalInitiated} הצעות חוק`);
    for (const b of billsResult.bills) {
      lines.push(`• ${b.updatedAt} — ${b.name} (${b.type})`);
    }
  }

  return {
    memberName:    fullName,
    personId,
    faction,
    rawSummary:    lines.filter(Boolean).join('\n'),
    votes:         voteRows,
    queries:       queriesResult.hasData ? queriesResult.queries : [],
    bills:         billsResult.hasData ? billsResult.bills : [],
    usedEndpoints: [vEp, queriesResult.endpoint, billsResult.endpoint].filter(Boolean),
    source:        'knesset_odata_v4',
  };
}

// ── Faction lookup ────────────────────────────────────────────────────────

async function fetchFactionMembers(factionNameQuery) {
  const { data, endpoint } = await odata(
    'KNS_PersonToPosition',
    `$filter=${encodeURIComponent(`KnessetNum eq ${KNESSET_NUM} and IsCurrent eq true`)}&$select=PersonID,FactionName&$top=300`
  );

  const query    = factionNameQuery.trim().toLowerCase();
  const factions = [...new Set(data.map((r) => r.FactionName).filter(Boolean))];
  const matched  = factions.find((f) => f.toLowerCase().includes(query))
    ?? factions.find((f) => query.split(/\s+/).some((w) => f.toLowerCase().includes(w)));

  if (!matched) {
    return { members: [], factionName: null, endpoint, allFactions: factions };
  }

  const personIds = [...new Set(
    data.filter((r) => r.FactionName === matched).map((r) => r.PersonID)
  )];
  const nameMap = personIds.length ? await fetchPersonNames(personIds) : {};
  const members = personIds.map((id) => nameMap[id] ?? `PersonID:${id}`);

  return { members, factionName: matched, endpoint };
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function findPersonByName(name) {
  const parts    = name.trim().split(/\s+/);
  const lastName = parts[parts.length - 1];

  const { data } = await odata(
    'KNS_Person',
    `$filter=${encodeURIComponent(`contains(LastName,'${lastName}') and IsCurrent eq true`)}&$select=Id,LastName,FirstName`
  );
  let rows = data;

  if (!rows.length) {
    const { data: fb } = await odata(
      'KNS_Person',
      `$filter=${encodeURIComponent(`contains(LastName,'${lastName}')`)}&$select=Id,LastName,FirstName,IsCurrent&$orderby=IsCurrent desc&$top=5`
    );
    rows = fb;
  }

  if (!rows.length) return null;
  if (rows.length === 1) return rows[0];
  if (parts.length > 1) {
    const firstName = parts[0];
    const match = rows.find(
      (r) => r.FirstName?.includes(firstName) || r.LastName?.includes(firstName)
    );
    if (match) return match;
  }
  return rows[0];
}

async function fetchPersonNames(personIds) {
  if (!personIds.length) return {};
  // API has URL length limits — batch into groups of 8
  const batches = [];
  for (let i = 0; i < personIds.length; i += 8) {
    batches.push(personIds.slice(i, i + 8));
  }
  const results = {};
  for (const batch of batches) {
    const filter = encodeURIComponent(batch.map((id) => `Id eq ${id}`).join(' or '));
    const { data } = await odata('KNS_Person', `$filter=${filter}&$select=Id,FirstName,LastName`);
    for (const r of data) results[r.Id] = `${r.FirstName} ${r.LastName}`;
  }
  return results;
}

// ── Legacy shims (used by bot.js / scheduler.js) ──────────────────────────

async function findMemberByName(name) {
  const person = await findPersonByName(name);
  if (!person) return [{ name, id: null }];
  return [{ name: `${person.FirstName} ${person.LastName}`, id: person.Id }];
}

async function getCommitteeMeetings() {
  const result = await getCommitteeSessions(7);
  return result.hasData ? result.sessions : [];
}

async function getMemberRecentVotes(mkId) {
  if (!mkId) return [];
  const { data } = await odata(
    'KNS_PlenumVoteResult',
    `$filter=${encodeURIComponent(`MkId eq ${mkId}`)}&$orderby=VoteID desc&$top=20&$select=VoteID,VoteDate,ResultCode,ResultDesc`
  );
  return data.map((r) => ({ voteId: r.VoteID, result: r.ResultDesc, date: r.VoteDate?.slice(0, 10) }));
}

module.exports = {
  // Core API (per spec)
  getRecentVotes,
  getVoteResults,
  getSwaps,
  getAbsences,
  getRecentSessions,
  getCommitteeSessions,
  getCurrentMembers,
  getMemberQueries,
  getMemberBills,
  // Compound
  fetchRecentActivity,
  findMemberActivity,
  fetchFactionMembers,
  // Legacy shims
  findMemberByName,
  getCommitteeMeetings,
  getMemberRecentVotes,
};
