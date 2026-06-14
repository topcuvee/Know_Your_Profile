export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
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

    // Score responses - answers array contains profile indices (0-7)
    const profiles = [0, 0, 0, 0, 0, 0, 0, 0]; // Creator, Star, Supporter, Accumulator, DealMaker, Lord, Trader, Mechanic

    // Map profile value to index: 0=Creator, 1=Star, 2=Supporter, 3=Accumulator, 4=Lord, 5=Mechanic, 6=DealMaker, 7=Trader
    const profileValueToIndex = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 5, 5: 7, 6: 4, 7: 6 };

    answers.forEach((profileValue) => {
      if (profileValue >= 0 && profileValue <= 7) {
        const idx = profileValueToIndex[profileValue];
        profiles[idx]++;
      }
    });

    // Find primary and secondary profiles
    const sorted = profiles
      .map((score, idx) => ({ profile: idx, score }))
      .sort((a, b) => b.score - a.score);

    const primaryIdx = sorted[0].profile;
    const secondaryIdx = sorted[1].profile;
    const profileNames = ['Creator', 'Star', 'Supporter', 'Accumulator', 'Deal Maker', 'Lord', 'Trader', 'Mechanic'];
    const frequencyGroupsMap = ['Dynamo', 'Dynamo', 'Blaze', 'Tempo', 'Blaze', 'Steel', 'Tempo', 'Steel'];

    const primaryProfile = profileNames[primaryIdx];
    const secondaryProfile = profileNames[secondaryIdx];
    const frequencyGroup = frequencyGroupsMap[primaryIdx];

    // Generate report via Claude
    const claudePrompt = `Return ONLY valid JSON, no markdown or extra text.

Primary: ${primaryProfile}
Secondary: ${secondaryProfile}
Frequency: ${frequencyGroup}
Scores: Creator:${profiles[0]} Star:${profiles[1]} Supporter:${profiles[2]} Accumulator:${profiles[3]} Deal Maker:${profiles[4]} Lord:${profiles[5]} Trader:${profiles[6]} Mechanic:${profiles[7]}

{
  "primary_profile": "${primaryProfile}",
  "secondary_profile": "${secondaryProfile}",
  "frequency_group": "${frequencyGroup}",
  "frequency_profiles": "${frequencyGroup === 'Dynamo' ? 'Creator + Star' : frequencyGroup === 'Blaze' ? 'Deal Maker + Supporter' : frequencyGroup === 'Tempo' ? 'Trader + Accumulator' : 'Lord + Mechanic'}",
  "profile_summary": "(3 sentences on ${primaryProfile} with a famous example, for managers, British English)",
  "frequency_summary": "(3 sentences on ${frequencyGroup} frequency group and its gap, British English)",
  "natural_strengths": "(3 sentences on ${primaryProfile}'s strengths, British English)",
  "blind_spots": "(3 sentences on ${primaryProfile}'s blind spots, British English)",
  "flow_state": "(2 sentences on what puts ${primaryProfile} in flow, British English)",
  "stress_state": "(2 sentences on what stresses ${primaryProfile}, British English)",
  "management_guide": "(3 sentences on managing ${primaryProfile}, British English)",
  "role_fit_strong": "(2 sentences on ideal roles for ${primaryProfile} in wine/hospitality, British English)",
  "role_fit_draining": "(2 sentences on draining roles for ${primaryProfile}, British English)",
  "hiring_verdict": "Strong fit or Conditional fit or Not recommended",
  "hiring_rationale": "(3 sentences on hiring verdict for ${primaryProfile}, British English)",
  "scoring_note": "(1 sentence on profile clarity)"
}`;

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY environment variable not set');
    }

    console.log('🔑 Using API key starting with:', process.env.ANTHROPIC_API_KEY.substring(0, 10) + '...');
    console.log('📤 Calling Claude API with prompt:', claudePrompt.substring(0, 100));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25 second timeout (Netlify limit is 26s)

    let claudeResponse;
    try {
      console.log('🌐 Fetching from: https://api.anthropic.com/v1/messages');
      claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{ role: 'user', content: claudePrompt }]
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      console.log('📥 Claude response status:', claudeResponse.status);
      if (!claudeResponse.ok) {
        const errorData = await claudeResponse.text();
        console.error('❌ Claude API error response:', errorData);
        throw new Error(`Claude API error ${claudeResponse.status}: ${errorData}`);
      }
    } catch (fetchError) {
      clearTimeout(timeout);
      console.error('❌ Claude fetch error:', fetchError.message);
      if (fetchError.name === 'AbortError') {
        throw new Error('Claude API timeout (25s) - request took too long');
      }
      throw fetchError;
    }

    const claudeData = await claudeResponse.json();
    console.log('Claude response data:', claudeData);

    if (!claudeData.content || !claudeData.content[0]) {
      throw new Error(`Invalid Claude response structure: ${JSON.stringify(claudeData)}`);
    }

    const reportText = claudeData.content[0].text;
    console.log('Claude report text (first 500 chars):', reportText.substring(0, 500));

    // Parse JSON from response (handle potential markdown wrapping)
    let report;
    try {
      report = JSON.parse(reportText);
      console.log('✅ Direct JSON parse successful');
    } catch (parseError) {
      console.error('Direct parse failed, trying to extract JSON...');
      console.log('Raw response (first 300 chars):', reportText.substring(0, 300));

      // Try multiple regex patterns
      let jsonMatch;

      // Try: ```json ... ```
      jsonMatch = reportText.match(/```json\s*([\s\S]*?)\s*```/i);
      if (jsonMatch) {
        console.log('Matched ```json pattern');
      }

      // Try: ``` ... ```
      if (!jsonMatch) {
        jsonMatch = reportText.match(/```\s*([\s\S]*?)\s*```/);
        if (jsonMatch) console.log('Matched ``` pattern');
      }

      // Try: { ... } (greedy)
      if (!jsonMatch) {
        jsonMatch = reportText.match(/\{[\s\S]*\}/);
        if (jsonMatch) console.log('Matched { } pattern');
      }

      if (!jsonMatch) {
        throw new Error(`Failed to find JSON in Claude response: ${reportText.substring(0, 300)}`);
      }

      const jsonStr = (jsonMatch[1] || jsonMatch[0]).trim();
      console.log('Extracted JSON (first 300 chars):', jsonStr.substring(0, 300));
      report = JSON.parse(jsonStr);
      console.log('✅ Extracted and parsed JSON successfully');
    }

    // Send email to people@topcuvee.com (non-blocking - don't fail if email fails)
    try {
      const emailHtml = generateManagerEmail(name, report);
      await sendEmail('people@topcuvee.com', `Profile Report — ${name}`, emailHtml);
      console.log(`✓ Email sent to people@topcuvee.com for ${name}`);
    } catch (emailError) {
      console.error('⚠ Email send failed (non-blocking):', emailError.message);
    }

    // Return candidate-facing report (lite version)
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        primary_profile: report.primary_profile,
        secondary_profile: report.secondary_profile,
        frequency_group: report.frequency_group,
        profile_summary: report.profile_summary,
        frequency_summary: report.frequency_summary,
        natural_strengths: report.natural_strengths,
        flow_state: report.flow_state,
        stress_state: report.stress_state
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

async function sendEmail(to, subject, htmlContent) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY environment variable not set');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to,
      subject,
      html: htmlContent
    })
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Resend API error ${response.status}: ${errorData}`);
  }

  return await response.json();
}

function generateManagerEmail(name, report) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #3D3D3D; background: #FFFEBC; }
    .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 6px 20px rgba(0,0,0,0.10); }
    .header { background: white; padding: 40px 30px; border-bottom: 3px solid #FF4E00; }
    .logo { font-family: 'Arial Black', sans-serif; font-size: 24px; font-weight: 700; text-transform: uppercase; color: #FF4E00; margin: 0 0 20px 0; letter-spacing: 1px; }
    .content { padding: 40px 30px; }
    .subject { font-size: 28px; font-weight: 700; text-transform: uppercase; color: #0A0A0A; margin: 0 0 30px 0; }
    .section { margin-bottom: 30px; }
    .section-title { font-size: 16px; font-weight: 700; text-transform: uppercase; color: #FF4E00; margin-bottom: 10px; letter-spacing: 1px; }
    .section-content { font-size: 14px; line-height: 1.8; color: #3D3D3D; }
    .badge { display: inline-block; background: #FF4E00; color: white; padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; margin-right: 8px; }
    .verdict { padding: 15px; border-radius: 6px; font-weight: 600; display: inline-block; }
    .verdict.strong { background: rgba(62, 153, 0, 0.1); color: #3E9900; }
    .verdict.conditional { background: rgba(255, 153, 0, 0.1); color: #FF9900; }
    .verdict.not { background: rgba(204, 34, 0, 0.1); color: #CC2200; }
    .footer { background: #F7F7F2; padding: 20px 30px; text-align: center; font-size: 12px; color: #7A7A7A; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Top Cuvée</div>
      <div class="subject">Profile Report: ${name}</div>
    </div>

    <div class="content">
      <div class="section">
        <div class="section-title">Profile</div>
        <div class="section-content">
          <span class="badge">${report.primary_profile}</span>
          <span class="badge">${report.secondary_profile}</span>
          <span class="badge">${report.frequency_group}</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Profile Summary</div>
        <div class="section-content">${report.profile_summary}</div>
      </div>

      <div class="section">
        <div class="section-title">Frequency Group</div>
        <div class="section-content">${report.frequency_summary}</div>
      </div>

      <div class="section">
        <div class="section-title">Natural Strengths</div>
        <div class="section-content">${report.natural_strengths}</div>
      </div>

      <div class="section">
        <div class="section-title">Blind Spots</div>
        <div class="section-content">${report.blind_spots}</div>
      </div>

      <div class="section">
        <div class="section-title">Flow vs Stress</div>
        <div class="section-content">
          <strong>In Flow:</strong> ${report.flow_state}<br><br>
          <strong>Under Stress:</strong> ${report.stress_state}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Management Guide</div>
        <div class="section-content">${report.management_guide}</div>
      </div>

      <div class="section">
        <div class="section-title">Role Fit</div>
        <div class="section-content">
          <strong>Strong Fit:</strong> ${report.role_fit_strong}<br><br>
          <strong>Likely Draining:</strong> ${report.role_fit_draining}
        </div>
      </div>

      <div class="section">
        <div class="section-title">Hiring Verdict</div>
        <div class="section-content">
          <div class="verdict ${report.hiring_verdict === 'Strong fit' ? 'strong' : report.hiring_verdict === 'Conditional fit' ? 'conditional' : 'not'}">${report.hiring_verdict}</div>
          <p style="margin-top: 15px;">${report.hiring_rationale}</p>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Scoring Note</div>
        <div class="section-content">${report.scoring_note}</div>
      </div>
    </div>

    <div class="footer">
      Generated by Top Cuvée Profile Assessment
    </div>
  </div>
</body>
</html>
`;
}
