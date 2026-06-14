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
    const frequencyGroup = frequencyGroupsMap[primaryIdx];

    // Return demo report
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_profile: primaryProfile,
        secondary_profile: profileNames[sorted[1].profile],
        frequency_group: frequencyGroup,
        profile_summary: `${primaryProfile}s are visionary innovators who generate ideas, challenge convention, and drive change. They thrive on developing new ideas, systems, and approaches. Like Steve Jobs, they are idea-led and future-focused.`,
        frequency_summary: `${frequencyGroup}s combine high-frequency energies with natural momentum and confidence. They operate at intensity and are fast-moving and idea-led. The gap: grounding, execution, and consistency.`,
        natural_strengths: `${primaryProfile}s naturally excel at ideation and strategic thinking. They see patterns others miss and generate innovative solutions. Their visionary approach and energy inspire teams to pursue ambitious goals.`,
        flow_state: `${primaryProfile}s thrive when thinking creatively and developing new concepts. They excel in environments that encourage innovation and reward unconventional thinking.`,
        stress_state: `Under pressure, ${primaryProfile}s may become scattered, jumping between ideas without follow-through. They can become frustrated with constraints or slow implementation.`
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
