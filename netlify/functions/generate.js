// ---- Wealth Dynamics framework reference (kept server-side, never shown in questions) ----
const SYSTEM_PROMPT = `You are an expert profiler writing for Top Cuvée, a growing wine and hospitality business. You produce candid, professional profile reports based on the Wealth Dynamics framework, used to understand how a person naturally works and where they fit on a team.

THE 8 PROFILES
- Creator (Dynamo): generative, idea-led, builds things, future-focused. Real-world archetype e.g. James Dyson, Steve Jobs.
- Star (Dynamo): magnetic, influential, leads through personal brand and presence. e.g. Richard Branson, Oprah Winfrey.
- Deal Maker (Blaze): connects people, reads rooms, negotiates, thrives on relationships and timing.
- Supporter (Blaze): relationship-led, loyal, team-first, lifts others. e.g. Sheryl Sandberg.
- Trader (Tempo): timing, rhythm, buying low/selling high, market sense.
- Accumulator (Tempo): patient, steady, asset-building, reliable, methodical. e.g. Warren Buffett.
- Lord (Steel): data, control, cashflow, systems, detail.
- Mechanic (Steel): process, optimisation, builds better systems, craft and quality.

THE 4 FREQUENCIES
- Dynamo (Creator + Star): generative, fast-moving, idea-led. Gap: grounding, execution, consistency.
- Blaze (Deal Maker + Supporter): people-first, relationship-led. Gap: systems, solitary focus, detail.
- Tempo (Trader + Accumulator): rhythm, patience, timing. Gap: speed, innovation.
- Steel (Lord + Mechanic): data, process, precision. Gap: people skills, flexibility.

WRITING RULES
- British English throughout.
- Write in the third person using the person's FIRST NAME (e.g. "Erin is a Star profile...").
- Ground everything in a wine / hospitality SME context — the kinds of roles Top Cuvée actually has (wine buying, brand and product, front of house, guest experience, wholesale and trade accounts, operations, finance, systems).
- Be direct, specific and useful. No coaching waffle, no hedging, no bullet-point padding — flowing prose only.
- Use the candidate's score distribution to judge how decisive vs. scattered the profile is, but describe it qualitatively. Do NOT quote raw numbers.
- In the archetype, name a single well-known real-world reference figure that fits the primary profile, and weave in the secondary profile's influence.
- The candidate reads every field EXCEPT hiring_verdict and assessment_rationale, which are for the hiring manager only — keep candidate-facing fields constructive and fair while still honest about blind spots.

Each field should be substantial — roughly 3-4 sentences (2-3 for flow_state and stress_state).`;

const PROFILE_NAMES = ['Creator', 'Star', 'Supporter', 'Accumulator', 'Deal Maker', 'Lord', 'Trader', 'Mechanic'];
const FREQUENCY_MAP = ['Dynamo', 'Dynamo', 'Blaze', 'Tempo', 'Blaze', 'Steel', 'Tempo', 'Steel'];

const JSON_INSTRUCTION = `Return ONLY a single valid JSON object — no markdown, no backticks, no text before or after. Use exactly these keys, each a string value:
{
  "archetype": "Who they are: primary archetype with a named real-world reference figure, plus how the secondary profile shapes them (3-4 sentences)",
  "frequency": "Their natural energy: what the frequency group means in practice, and whether the profile is decisive or scattered (qualitative) (3-4 sentences)",
  "natural_strengths": "Where they shine, in a wine/hospitality context (3-4 sentences)",
  "blind_spots": "Where they struggle or create friction — direct and specific (3-4 sentences)",
  "flow_state": "What puts them in flow (2-3 sentences)",
  "stress_state": "How stress shows up and what derails them (2-3 sentences)",
  "management_guide": "How to get the best out of them: communication, autonomy, feedback, motivation (3-4 sentences)",
  "role_fit_strong": "Specific wine/hospitality roles where they will thrive (3-4 sentences)",
  "role_fit_avoid": "Specific roles and responsibilities that will drain them (3-4 sentences)",
  "hiring_verdict": "One of exactly: Strong fit, Conditional fit, Not recommended",
  "assessment_rationale": "Manager-only one-paragraph rationale for the verdict, noting how decisive the scores are"
}`;

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' } };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { answers, name } = JSON.parse(event.body);
    if (!answers || answers.length !== 36 || !name) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid input' }) };
    }

    // Score responses
    const profiles = [0, 0, 0, 0, 0, 0, 0, 0];
    const profileValueToIndex = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 5, 5: 7, 6: 4, 7: 6 };
    answers.forEach((v) => { if (v >= 0 && v <= 7) profiles[profileValueToIndex[v]]++; });

    const sorted = profiles
      .map((score, idx) => ({ profile: idx, score }))
      .sort((a, b) => b.score - a.score);

    const primaryIdx = sorted[0].profile;
    const primaryProfile = PROFILE_NAMES[primaryIdx];
    const secondaryProfile = PROFILE_NAMES[sorted[1].profile];
    const frequencyGroup = FREQUENCY_MAP[primaryIdx];
    const firstName = name.trim().split(/\s+/)[0];
    const distribution = sorted.filter(s => s.score > 0)
      .map(s => `${PROFILE_NAMES[s.profile]}: ${s.score}`).join(', ');

    const userPrompt = `Write a profile report for this candidate.

First name: ${firstName}
Primary profile: ${primaryProfile}
Secondary profile: ${secondaryProfile}
Frequency group: ${frequencyGroup}
Score distribution (out of 36, for qualitative judgement only — do not quote numbers): ${distribution}

${JSON_INSTRUCTION}`;

    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 24000);

    let report = null;
    let debugError = null;
    try {
      const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 2500,
          system: SYSTEM_PROMPT,
          thinking: { type: 'disabled' },
          output_config: { effort: 'low' },
          messages: [{ role: 'user', content: userPrompt }]
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!claudeRes.ok) {
        const errText = await claudeRes.text();
        throw new Error(`Claude API ${claudeRes.status}: ${errText}`);
      }
      const claudeData = await claudeRes.json();
      let text = (claudeData.content.find(b => b.type === 'text')?.text || '').trim();
      // Strip markdown fences if present
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
      try {
        report = JSON.parse(text);
      } catch {
        const s = text.indexOf('{'), e = text.lastIndexOf('}');
        if (s >= 0 && e > s) report = JSON.parse(text.substring(s, e + 1));
        else throw new Error('No JSON object in response: ' + text.slice(0, 200));
      }
      if (!report.archetype) throw new Error('Parsed JSON missing fields');
      console.log('✅ Claude report generated for', firstName);
    } catch (apiError) {
      clearTimeout(timeout);
      debugError = apiError.message;
      console.error('❌ Claude generation failed:', apiError.message);
      report = fallbackReport(firstName, primaryProfile, secondaryProfile, frequencyGroup);
    }

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
<h3>Our Assessment: ${r.hiring_verdict}</h3><p>${r.assessment_rationale}</p>`;
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

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_profile: primaryProfile,
        secondary_profile: secondaryProfile,
        frequency_group: frequencyGroup,
        report,
        _debug: debugError
      })
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: error.message })
    };
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
