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

    const claudePrompt = `You MUST return ONLY valid JSON, nothing else. No markdown, no text before or after.

Return exactly this JSON structure with real content:
{
  "profile_summary": "3 sentences about ${primaryProfile}",
  "frequency_summary": "3 sentences about ${frequencyGroup} frequency",
  "natural_strengths": "3 sentences on ${primaryProfile}'s strengths",
  "flow_state": "2 sentences on when ${primaryProfile} is in flow",
  "stress_state": "2 sentences on ${primaryProfile} under stress"
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
    if (!report || !report.profile_summary) {
      report = {
        profile_summary: `${primaryProfile}s are natural innovators with distinctive strengths in their domain. They bring focus and expertise to their work. Their approach is direct and effective.`,
        frequency_summary: `${frequencyGroup}s operate with characteristic energy and focus. They bring momentum and commitment to their roles. The gap: flexibility and breadth beyond their specialty.`,
        natural_strengths: `${primaryProfile}s excel at their core competencies. They bring dedication and expertise. Their focus and reliability are assets to any team.`,
        flow_state: `${primaryProfile}s thrive when working in their areas of strength. They excel with clear objectives and autonomy.`,
        stress_state: `Under pressure, ${primaryProfile}s may become overly focused or rigid. They benefit from support and broader perspective.`
      };
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_profile: primaryProfile,
        secondary_profile: secondaryProfile,
        frequency_group: frequencyGroup,
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
