const SYSTEM_PROMPT = `You write profile reports for a wine and hospitality company. Third person, first name only (e.g. "Sarah is..."), British English, direct and specific. No jargon, no padding. Reference a real-world figure for the archetype.`;

const PROFILE_NAMES = ['Creator', 'Star', 'Supporter', 'Accumulator', 'Deal Maker', 'Lord', 'Trader', 'Mechanic'];
const FREQUENCY_MAP = ['Dynamo', 'Dynamo', 'Blaze', 'Tempo', 'Blaze', 'Steel', 'Tempo', 'Steel'];

const JSON_INSTRUCTION = `Output JSON only, no markdown or backticks:
{"archetype":"3-4 sentences with a named reference figure","frequency":"3-4 sentences","natural_strengths":"3-4 sentences in wine/hospitality context","blind_spots":"3-4 sentences direct","flow_state":"2-3 sentences","stress_state":"2-3 sentences","management_guide":"3-4 sentences","role_fit_strong":"3-4 wine/hospitality roles","role_fit_avoid":"3-4 roles to avoid","hiring_verdict":"Strong fit OR Conditional fit OR Not recommended","assessment_rationale":"1 paragraph with verdict rationale"}`;

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
    const timeout = setTimeout(() => controller.abort(), 9000);

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
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1200,
          system: SYSTEM_PROMPT,
          thinking: { type: 'disabled' },
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
