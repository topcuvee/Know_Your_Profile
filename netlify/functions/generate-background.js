import { getStore } from '@netlify/blobs';

// ---- Wealth Dynamics framework reference (kept server-side, never shown in questions) ----
const SYSTEM_PROMPT = `You are an expert profiler writing for Top Cuvée, a growing wine and hospitality business. You produce candid, professional profile reports based on the Wealth Dynamics framework, used to understand how a person naturally works and where they fit on a team.

THE 8 PROFILES
- Creator (Dynamo): generative, idea-led, builds things, future-focused. Real-world archetype e.g. James Dyson, Steve Jobs.
- Star (Dynamo): magnetic, influential, leads through personal brand and presence. e.g. Richard Branson, Oprah Winfrey.
- Deal Maker (Blaze): connects people, reads rooms, negotiates, thrives on relationships and timing. e.g. a great commercial dealmaker.
- Supporter (Blaze): relationship-led, loyal, team-first, lifts others. e.g. Sheryl Sandberg.
- Trader (Tempo): timing, rhythm, buying low/selling high, market sense. e.g. a sharp buyer/trader.
- Accumulator (Tempo): patient, steady, asset-building, reliable, methodical. e.g. Warren Buffett.
- Lord (Steel): data, control, cashflow, systems, detail. e.g. a rigorous operator/financier.
- Mechanic (Steel): process, optimisation, builds better systems, craft and quality. e.g. an engineer-operator.

THE 4 FREQUENCIES
- Dynamo (Creator + Star): generative, fast-moving, idea-led. Gap: grounding, execution, consistency.
- Blaze (Deal Maker + Supporter): people-first, relationship-led. Gap: systems, solitary focus, detail.
- Tempo (Trader + Accumulator): rhythm, patience, timing. Gap: speed, innovation.
- Steel (Lord + Mechanic): data, process, precision. Gap: people skills, flexibility.

WRITING RULES
- British English throughout.
- Write in the third person using the person's FIRST NAME (e.g. "Erin is a Star profile...").
- Ground everything in a wine / hospitality SME context — the kinds of roles and situations Top Cuvée actually has (wine buying, brand and product, front of house, guest experience, wholesale and trade accounts, operations, finance, systems).
- Be direct, specific and useful. No coaching waffle, no hedging, no bullet-point padding — flowing prose only.
- Use the candidate's actual score distribution to judge how decisive vs. scattered the profile is, but describe it qualitatively. Do NOT quote raw numbers.
- In the archetype, name a single well-known real-world reference figure that fits the primary profile, and weave in the secondary profile's influence.
- The candidate will read every field EXCEPT hiring_verdict and assessment_rationale, which are for the hiring manager only — so keep the candidate-facing fields constructive and fair while still honest about blind spots.

Each field should be substantial — roughly 3–5 sentences (2–3 for flow_state and stress_state), matching the depth of a professional written assessment.`;

const PROFILE_NAMES = ['Creator', 'Star', 'Supporter', 'Accumulator', 'Deal Maker', 'Lord', 'Trader', 'Mechanic'];
const FREQUENCY_MAP = ['Dynamo', 'Dynamo', 'Blaze', 'Tempo', 'Blaze', 'Steel', 'Tempo', 'Steel'];

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    archetype: { type: 'string', description: "Who they are: primary profile archetype with a real-world reference figure, and how the secondary profile shapes them." },
    frequency: { type: 'string', description: "Their natural energy: what the frequency group means in practice, and how concentrated vs. spread their profile is (qualitative)." },
    natural_strengths: { type: 'string', description: "Where they shine, in a wine/hospitality context." },
    blind_spots: { type: 'string', description: "Where they struggle or create friction. Direct and specific." },
    flow_state: { type: 'string', description: "What puts them in flow (2-3 sentences)." },
    stress_state: { type: 'string', description: "How stress shows up and what derails them (2-3 sentences)." },
    management_guide: { type: 'string', description: "How to get the best out of them: communication, autonomy, feedback, motivation." },
    role_fit_strong: { type: 'string', description: "Roles and functions in a wine/hospitality SME where they will thrive." },
    role_fit_avoid: { type: 'string', description: "Roles and responsibilities that will drain them." },
    hiring_verdict: { type: 'string', enum: ['Strong fit', 'Conditional fit', 'Not recommended'], description: "Manager-only verdict." },
    assessment_rationale: { type: 'string', description: "Manager-only: one-paragraph plain-English rationale for the verdict, noting score decisiveness." }
  },
  required: [
    'archetype', 'frequency', 'natural_strengths', 'blind_spots', 'flow_state',
    'stress_state', 'management_guide', 'role_fit_strong', 'role_fit_avoid',
    'hiring_verdict', 'assessment_rationale'
  ],
  additionalProperties: false
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  let reportId;
  try {
    const body = JSON.parse(event.body);
    const { answers, name } = body;
    reportId = body.reportId;

    if (!answers || answers.length !== 36 || !name || !reportId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid input' }) };
    }

    const store = getStore('reports');

    // Score responses
    const profiles = [0, 0, 0, 0, 0, 0, 0, 0];
    const profileValueToIndex = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 5, 5: 7, 6: 4, 7: 6 };
    answers.forEach((v) => {
      if (v >= 0 && v <= 7) profiles[profileValueToIndex[v]]++;
    });

    const sorted = profiles
      .map((score, idx) => ({ profile: idx, score }))
      .sort((a, b) => b.score - a.score);

    const primaryIdx = sorted[0].profile;
    const primaryProfile = PROFILE_NAMES[primaryIdx];
    const secondaryProfile = PROFILE_NAMES[sorted[1].profile];
    const frequencyGroup = FREQUENCY_MAP[primaryIdx];

    const firstName = name.trim().split(/\s+/)[0];

    // Readable score distribution (qualitative use only)
    const distribution = sorted
      .filter(s => s.score > 0)
      .map(s => `${PROFILE_NAMES[s.profile]}: ${s.score}`)
      .join(', ');

    const userPrompt = `Write a profile report for this candidate.

First name: ${firstName}
Primary profile: ${primaryProfile}
Secondary profile: ${secondaryProfile}
Frequency group: ${frequencyGroup}
Score distribution (out of 36, for your qualitative judgement only — do not quote the numbers): ${distribution}

Fill every field of the report.`;

    let report;
    try {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          output_config: {
            effort: 'high',
            format: { type: 'json_schema', schema: REPORT_SCHEMA }
          },
          messages: [{ role: 'user', content: userPrompt }]
        })
      });

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        throw new Error(`Claude API ${claudeRes.status}: ${errText}`);
      }

      const claudeData = await claudeRes.json();
      const text = claudeData.content.find(b => b.type === 'text')?.text || '';
      report = JSON.parse(text);
      console.log('✅ Claude report generated for', firstName);
    } catch (apiError) {
      console.error('❌ Claude generation failed:', apiError.message);
      report = null;
    }

    if (!report || !report.archetype) {
      report = fallbackReport(firstName, primaryProfile, secondaryProfile, frequencyGroup);
    }

    const fullResult = {
      status: 'done',
      primary_profile: primaryProfile,
      secondary_profile: secondaryProfile,
      frequency_group: frequencyGroup,
      report
    };

    await store.setJSON(reportId, fullResult);

    // Send manager email (non-blocking)
    if (process.env.RESEND_API_KEY && process.env.MANAGER_EMAIL) {
      try {
        const r = report;
        const emailHtml = `
<h2>Profile Assessment: ${name}</h2>
<p><strong>Primary:</strong> ${primaryProfile} &nbsp;|&nbsp; <strong>Secondary:</strong> ${secondaryProfile} &nbsp;|&nbsp; <strong>Frequency:</strong> ${frequencyGroup}</p>
<hr>
<h3>Who They Are</h3><p>${r.archetype}</p>
<h3>Natural Energy</h3><p>${r.frequency}</p>
<h3>Natural Strengths</h3><p>${r.natural_strengths}</p>
<h3>Blind Spots</h3><p>${r.blind_spots}</p>
<h3>Flow vs Stress</h3><p><strong>In flow:</strong> ${r.flow_state}</p><p><strong>Under stress:</strong> ${r.stress_state}</p>
<h3>How They're Best Managed</h3><p>${r.management_guide}</p>
<h3>Role Fit</h3><p><strong>Strong fit:</strong> ${r.role_fit_strong}</p><p><strong>Roles to avoid:</strong> ${r.role_fit_avoid}</p>
<hr>
<h3>Our Assessment: ${r.hiring_verdict}</h3><p>${r.assessment_rationale}</p>
`;
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'noreply@reports.topcuvee.com',
            to: process.env.MANAGER_EMAIL,
            subject: `Profile Report: ${name} (${primaryProfile})`,
            html: emailHtml
          })
        });
        const emailData = await emailRes.json();
        if (!emailRes.ok) console.error('⚠ Email failed:', JSON.stringify(emailData));
        else console.log('✅ Manager email sent:', emailData.id);
      } catch (emailError) {
        console.error('⚠ Email error:', emailError.message);
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (error) {
    console.error('Fatal error:', error);
    // Best-effort: record the error so the client stops polling
    try {
      if (reportId) {
        const store = getStore('reports');
        await store.setJSON(reportId, { status: 'error', error: error.message });
      }
    } catch (_) { /* ignore */ }
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

function fallbackReport(firstName, primary, secondary, frequency) {
  return {
    archetype: `${firstName} is a ${primary} profile, with a ${secondary} secondary. ${primary}s bring a distinctive way of working that shapes how they contribute to a team.`,
    frequency: `${firstName} sits in the ${frequency} frequency, which defines how they naturally create value and where their energy is strongest.`,
    natural_strengths: `${firstName} brings real strength in the areas core to the ${primary} profile, and will add the most value where those instincts are put to work.`,
    blind_spots: `Like most ${primary}s, ${firstName} will be less comfortable outside their natural zone, and benefits from being paired with complementary strengths.`,
    flow_state: `${firstName} is in flow when working to their strengths with a clear brief and room to operate.`,
    stress_state: `Under pressure, ${firstName} can default to their less helpful tendencies and benefits from support and clarity.`,
    management_guide: `Give ${firstName} clear direction, recognise their contribution, and pair them with people who cover their blind spots.`,
    role_fit_strong: `Roles that play to the ${primary} profile's natural strengths within a wine or hospitality setting.`,
    role_fit_avoid: `Roles that demand sustained work against the grain of the ${primary} profile.`,
    hiring_verdict: 'Conditional fit',
    assessment_rationale: `Automated summary unavailable in full — review the profile scores and the candidate-facing report before deciding.`
  };
}
