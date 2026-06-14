# Top Cuvée Profile Assessment

A password-protected personality assessment web app that administers a 36-question self-assessment, generates tailored profile reports via Claude AI, and emails manager reports automatically.

## Features

- **Password-gated access** – Single shared password (`TCkyp2026`)
- **36-question assessment** – Forced-choice (A/B/C/D) across 6 sections
- **Instant report generation** – Claude API scores and generates rich reports in ~1200 tokens
- **Dual output:**
  - Candidate-facing lite report (on-screen with print-to-PDF)
  - Manager-facing full report (emailed as HTML to `people@topcuvee.com`)
- **Netlify functions** – Serverless scoring, report generation, and email delivery
- **Top Cuvée brand** – Full design system integration (typography, colours, spacing)

## Deployment

### Prerequisites

- Netlify account
- ANTHROPIC_API_KEY (Claude API)
- RESEND_API_KEY (Resend email service)

### Steps

1. **Connect repo to Netlify**
   ```bash
   # Push to GitHub
   git remote add origin https://github.com/your-org/tc-profile-assessment.git
   git push -u origin main
   ```

2. **Set environment variables in Netlify dashboard**
   - Go to Settings → Environment
   - Add `ANTHROPIC_API_KEY`
   - Add `RESEND_API_KEY`

3. **Deploy**
   - Netlify auto-deploys on push
   - Or manually trigger: `netlify deploy --prod`

## Local Development

```bash
# Install dependencies (minimal - no npm packages required)
npm install

# Test locally with Netlify CLI
netlify dev

# Visit http://localhost:8888
```

## Assessment Content

The assessment covers 6 sections:
1. How you work best
2. Strengths and natural tendencies
3. Energy and motivation
4. Working with others
5. Under pressure
6. Ambition and direction

Each section has 6 forced-choice questions (A/B/C/D). Scoring maps responses to 8 profiles:
- **Dynamo**: Creator + Star (generative, fast-moving)
- **Blaze**: Deal Maker + Supporter (people-first)
- **Tempo**: Trader + Accumulator (rhythm, patience)
- **Steel**: Lord + Mechanic (data, process)

## Report Structure

### Candidate Report (on-screen)
- Primary profile name + frequency group badge
- Profile summary (3 sentences, includes famous example)
- Frequency group summary (2 sentences max)
- Natural strengths
- Flow vs stress (in flow + under stress)
- Print to PDF button

### Manager Report (emailed)
Adds to candidate content:
- Blind spots
- Management guide
- Role fit (strong + draining)
- Hiring verdict (green/amber/red badge)
- Hiring rationale
- Scoring note

Both written in British English, tone professional and direct.

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Backend**: Netlify Functions (Node.js)
- **Report Generation**: Claude API (haiku-4-5-20251001, 1200 tokens)
- **Email**: Resend API
- **Hosting**: Netlify

## Project Structure

```
tc-profile-assessment/
├── public/
│   └── index.html              # Full SPA (password, name, assessment, report)
├── netlify/
│   └── functions/
│       └── generate.js         # Scoring, Claude generation, Resend email
├── netlify.toml                # Build config
├── package.json
├── .gitignore
└── README.md
```

## API Endpoint

**POST** `/.netlify/functions/generate`

Request:
```json
{
  "answers": [0, 1, 2, 3, ...],  // 36 profile indices from scoring matrix
  "name": "Candidate Name"
}
```

Response (candidate-facing report):
```json
{
  "primary_profile": "Creator",
  "secondary_profile": "Star",
  "frequency_group": "Dynamo",
  "profile_summary": "...",
  "frequency_summary": "...",
  "natural_strengths": "...",
  "flow_state": "...",
  "stress_state": "..."
}
```

Manager report is emailed separately to `people@topcuvee.com`.

## Scoring Rules

Each question's options (A/B/C/D) map to one of 8 profiles. The frontend applies the scoring matrix, sending profile indices (0-7) to the backend:

- 0 = Creator
- 1 = Star
- 2 = Supporter
- 3 = Accumulator
- 4 = Lord
- 5 = Mechanic
- 6 = Deal Maker
- 7 = Trader

The backend tallies scores across all 36 responses and identifies primary (highest) and secondary (second-highest) profiles.

## Customisation

### Password
Edit `public/index.html` line 218:
```javascript
const PASSWORD = 'TCkyp2026';
```

### Manager Email
Change recipient in `netlify/functions/generate.js` line 61:
```javascript
await sendEmail('people@topcuvee.com', ...);
```

### Email Template
Edit `generateManagerEmail()` function in `netlify/functions/generate.js` for styling and layout.

### Assessment Questions
Questions and scoring matrix are in `public/index.html` lines 222–288. Update and re-sync the scoring matrix in `netlify/functions/generate.js` if needed.

## Troubleshooting

### "Failed to generate report"
- Check Netlify function logs: `netlify logs`
- Verify `ANTHROPIC_API_KEY` is set
- Check Claude API quota and billing

### Email not received
- Verify `RESEND_API_KEY` is set
- Check that `people@topcuvee.com` is in Resend domain allowlist
- Check Resend dashboard for bounce/failure logs

### Scoring incorrect
- Verify the scoring matrix in `public/index.html` matches the assessment PDF
- Check profile value mapping in `netlify/functions/generate.js` line 40

## Support

For issues or feature requests, file an issue in the repository or contact the Top Cuvée team.

---

**Created**: June 2026  
**Brand**: Top Cuvée  
**Password**: TCkyp2026
