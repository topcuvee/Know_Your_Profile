import { getStore } from '@netlify/blobs';

export const handler = async (event) => {
  const id = event.queryStringParameters?.id;
  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
  }

  try {
    const store = getStore('reports');
    const result = await store.get(id, { type: 'json' });

    if (!result) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' })
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('report-status error:', error);
    return { statusCode: 500, body: JSON.stringify({ status: 'error', error: error.message }) };
  }
};
