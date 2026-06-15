export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { answers, name } = JSON.parse(event.body);

    if (!answers || answers.length !== 36 || !name) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid input' })
      };
    }

    // Score responses
    const profiles = [0, 0, 0, 0, 0, 0, 0, 0];
    const profileValueToIndex = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 5, 5: 7, 6: 4, 7: 6 };

    answers.forEach((profileValue) => {
      if (profileValue >= 0 && profileValue <= 7) {
        profiles[profileValueToIndex[profileValue]]++;
      }
    });

    // Find primary profile
    const sorted = profiles
      .map((score, idx) => ({ profile: idx, score }))
      .sort((a, b) => b.score - a.score);

    const primaryIdx = sorted[0].profile;
    const profileNames = ['Creator', 'Star', 'Supporter', 'Accumulator', 'Deal Maker', 'Lord', 'Trader', 'Mechanic'];
    const frequencyGroupsMap = ['Dynamo', 'Dynamo', 'Blaze', 'Tempo', 'Blaze', 'Steel', 'Tempo', 'Steel'];

    const primaryProfile = profileNames[primaryIdx];
    const secondaryProfile = profileNames[sorted[1].profile];
    const frequencyGroup = frequencyGroupsMap[primaryIdx];

    // Call Claude API for report
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const claudePrompt = `You are an expert in the Wealth Dynamics framework. Generate a comprehensive profile report for a ${primaryProfile} with ${frequencyGroup} frequency.

Return ONLY valid JSON, nothing else. No markdown, no extra text.

Generate TWO versions:
1. candidate_report: A concise, encouraging 3-4 sentence profile summary for the person taking the assessment
2. manager_report: A detailed, professional report with these sections:
   - profile_summary: 3-4 sentences on the archetype, including a real-world example
   - frequency_group: 2-3 sentences on what ${frequencyGroup} means in practice
   - natural_strengths: 3-4 sentences on what they excel at naturally
   - blind_spots: 2-3 sentences on where they struggle or create friction
   - flow_state: 2-3 sentences on when they're at their best
   - stress_state: 2-3 sentences on how stress manifests for them
   - management_guide: 3-4 sentences on how to get the best from them
   - role_fit_strong: 2-3 sentence list of roles where they thrive
   - role_fit_draining: 2-3 sentence list of roles that drain them
   - hiring_verdict: One sentence: "Strong fit", "Conditional fit", or "Not recommended" with one sentence rationale

{
  "candidate_report": "string",
  "manager_report": {
    "profile_summary": "string",
    "frequency_group": "string",
    "natural_strengths": "string",
    "blind_spots": "string",
    "flow_state": "string",
    "stress_state": "string",
    "management_guide": "string",
    "role_fit_strong": "string",
    "role_fit_draining": "string",
    "hiring_verdict": "string"
  }
}`;

    let report;
    try {
      const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{ role: 'user', content: claudePrompt }]
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!claudeResponse.ok) {
        throw new Error(`Claude API: ${claudeResponse.status}`);
      }

      const claudeData = await claudeResponse.json();
      let responseText = claudeData.content[0].text.trim();

      // Strip markdown wrapper if present
      if (responseText.startsWith('```json')) {
        responseText = responseText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (responseText.startsWith('```')) {
        responseText = responseText.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      // Parse JSON - try direct parse first, then extract from braces
      try {
        report = JSON.parse(responseText);
      } catch {
        const jsonStart = responseText.indexOf('{');
        const jsonEnd = responseText.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
          const jsonStr = responseText.substring(jsonStart, jsonEnd + 1);
          report = JSON.parse(jsonStr);
        } else {
          throw new Error('No valid JSON in response');
        }
      }

      console.log('✅ Claude report received');
    } catch (apiError) {
      clearTimeout(timeout);
      console.error('⚠ Claude API failed:', apiError.message);
      // Use fallback
      report = null;
    }

    // Fallback if Claude failed
    if (!report || !report.candidate_report) {
      report = {
        candidate_report: `You are a ${primaryProfile}—naturally driven to ${primaryProfile.toLowerCase() === 'creator' ? 'innovate and bring new ideas to life' : primaryProfile.toLowerCase() === 'star' ? 'inspire and influence others' : primaryProfile.toLowerCase() === 'supporter' ? 'support and enable others' : primaryProfile.toLowerCase() === 'accumulator' ? 'build and accumulate value' : primaryProfile.toLowerCase() === 'deal maker' ? 'connect and negotiate' : primaryProfile.toLowerCase() === 'trader' ? 'recognize opportunity and timing' : primaryProfile.toLowerCase() === 'lord' ? 'control systems and data' : 'optimize and improve systems'}. Your ${frequencyGroup} frequency means you operate with distinctive energy patterns.`,
        manager_report: {
          profile_summary: `${primaryProfile}s bring distinctive strengths to their role. They are naturally driven to contribute in meaningful ways. Their approach is reliable and focused.`,
          frequency_group: `The ${frequencyGroup} frequency means this person operates with characteristic energy and momentum. They bring commitment to their roles.`,
          natural_strengths: `${primaryProfile}s excel at their core competencies with dedication and expertise. Their focus and reliability are assets to any team.`,
          blind_spots: `They may struggle with areas outside their core expertise. Flexibility and adaptability can sometimes be challenging.`,
          flow_state: `They thrive when working in their areas of strength with clear objectives and autonomy.`,
          stress_state: `Under pressure, they may become overly focused on their specialty. Support and broader perspective help them regain balance.`,
          management_guide: `Provide clear direction, recognize their contributions, and give them autonomy in their strengths. Support development in weaker areas.`,
          role_fit_strong: `Roles leveraging their core strengths and expertise where consistency and focus are valued.`,
          role_fit_draining: `Roles requiring constant context-switching, high visibility, or work far outside their natural strengths.`,
          hiring_verdict: `Conditional fit—strong in specialized roles, requires support in broader responsibilities.`
        }
      };
    }

    // Send manager email (non-blocking)
    if (process.env.RESEND_API_KEY && process.env.MANAGER_EMAIL) {
      try {
        const mgr = report.manager_report;
        const emailHtml = `
<h2>Profile Assessment Report: ${name}</h2>
<p><strong>Primary Profile:</strong> ${primaryProfile}</p>
<p><strong>Secondary Profile:</strong> ${secondaryProfile}</p>
<p><strong>Frequency Group:</strong> ${frequencyGroup}</p>

<h3>Profile Summary</h3>
<p>${mgr.profile_summary}</p>

<h3>Frequency Group</h3>
<p>${mgr.frequency_group}</p>

<h3>Natural Strengths</h3>
<p>${mgr.natural_strengths}</p>

<h3>Blind Spots</h3>
<p>${mgr.blind_spots}</p>

<h3>Flow vs Stress</h3>
<p><strong>In Flow:</strong> ${mgr.flow_state}</p>
<p><strong>Under Stress:</strong> ${mgr.stress_state}</p>

<h3>Management Guide</h3>
<p>${mgr.management_guide}</p>

<h3>Role Fit</h3>
<p><strong>Strong Fit:</strong> ${mgr.role_fit_strong}</p>
<p><strong>Draining:</strong> ${mgr.role_fit_draining}</p>

<h3>Hiring Verdict</h3>
<p>${mgr.hiring_verdict}</p>
        `;

        const emailResponse = await fetch('https://api.resend.com/emails', {
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
        const emailData = await emailResponse.json();
        if (!emailResponse.ok) {
          throw new Error(`Resend API ${emailResponse.status}: ${JSON.stringify(emailData)}`);
        }
      } catch (emailError) {
        // Email send failed silently - non-blocking
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_profile: primaryProfile,
        secondary_profile: secondaryProfile,
        frequency_group: frequencyGroup,
        candidate_report: report.candidate_report,
        manager_report: report.manager_report
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
