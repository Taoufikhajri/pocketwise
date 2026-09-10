# Enable receipt photos and voice entry

The new controls appear in **Add transaction → Scan bill / Voice entry**. This version uses OpenAI. You do not need to send your API key in a chat or put it in GitHub.

## Update an existing Pocketwise deployment

1. Replace your GitHub source with the contents of this updated `pocketwise` folder. Include the new `api` and `server` folders, `vite.config.js`, updated `vercel.json`, and all source files.
2. In your existing Supabase project's SQL Editor, run **`supabase/smart-entry.sql`**. It adds a usage counter and function, and preserves all existing transactions, budgets, and accounts. Do **not** rerun `schema.sql` on an existing installation.
3. In **Vercel → your project → Settings → Environment Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `OPENAI_API_KEY` | Your OpenAI API key |
   | `AI_ALLOWED_EMAILS` | The email you use to sign in to Pocketwise |

4. Keep your existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The server also uses these public values to verify your login and reserve a usage attempt.
5. Redeploy. Sign in with the allowed, confirmed email account.

Use Production scope for your live app. Add Preview scope only if you want that deployment to use the key too. **Never name the key `VITE_OPENAI_API_KEY`: values prefixed with `VITE_` are shipped to the browser.** The included `.env.example` contains names and placeholders, not a key.

To allow another trusted account, add its email to `AI_ALLOWED_EMAILS`, separated by a comma. Signing up for Pocketwise alone does not grant use of your paid API key. If either the key or allowlist is empty, smart entry stays disabled. Manual entry still works.

For a brand-new installation, first follow `README.md` and run `schema.sql`, then run `smart-entry.sql` and add these settings.

## API account and models

The key needs access and API billing/credits for:

- `gpt-4.1-mini`: reads receipt images and structures transactions.
- `gpt-4o-mini-transcribe`: turns voice notes into text before extraction.

Optional server-only settings `OPENAI_EXTRACT_MODEL` and `OPENAI_TRANSCRIBE_MODEL` override these defaults. Keep an extraction model that supports image input and strict structured outputs. The transcription model must support the audio transcription endpoint and JSON output. See [image inputs](https://developers.openai.com/api/docs/guides/images-vision), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), and [file transcription](https://developers.openai.com/api/docs/guides/speech-to-text).

Set an appropriate spending limit in your API account. Pocketwise permits **30 smart-entry attempts per account per UTC day**. A photo or typed description uses one extraction request; a voice note uses a transcription request plus an extraction request. Attempts are reserved before contacting OpenAI, so failed or cancelled requests can still count toward the daily limit and provider charges.

## Scan a bill or receipt

1. Choose **Add transaction → Scan bill**.
2. Use **Take a photo** on a supported phone, or upload a JPG, PNG, or WebP image.
3. Check the preview. Keep the merchant, date, and final total readable; use one receipt at a time.
4. Choose **Create draft** to send the prepared image for analysis.
5. Review and correct the suggested amount, date, category, account, and note.
6. Choose **Add transaction** to save it.

The client accepts source images up to 15 MB and 40 million pixels. It resizes the longest edge to 2,048 pixels and re-encodes to JPEG before sending at most 2 MB. HEIC and PDF are not supported in this version; export a JPG or take a screenshot. No original receipt attachment is saved.

## Record or upload a voice note

1. Choose **Add transaction → Voice entry → Start recording**.
2. Allow microphone access. Say one transaction clearly, for example: “I spent CAD twelve dollars and fifty cents on lunch yesterday, paid cash.”
3. Stop recording. Recording also stops after 60 seconds or when the page becomes hidden.
4. Listen to the playback, then choose **Create draft**.
5. Read the transcript and correct the suggested transaction before saving.

Recording needs a compatible browser and an HTTPS page (or localhost during development). If recording is unavailable or permission is denied, upload WebM, MP4/M4A, MP3, or WAV audio up to 2 MB. You can also type the transaction in the description box. If a clip is selected, the clip takes precedence over typed text; return to manual entry and reopen Voice entry to use text alone.

## What to review

- AI can misread or mishear amounts, dates, categories, or merchant names. Suggestions are drafts, never automatic database writes.
- Missing totals or dates stay blank. An unclear payment account must be selected by you.
- A foreign-currency source clears the amount and asks you to enter it in your workspace currency. This app does not calculate exchange rates.
- If a transaction with the same date, amount, and type already exists, the review screen shows a possible-duplicate warning. This is a simple check, not receipt fingerprinting.
- One receipt becomes one transaction using its final total. Separate line items and batches of receipts are not imported.
- An unpaid bill is not proof of a paid expense; check its payment status. Nothing in this app makes payments.

## Privacy and storage

The app sends the selected image, audio, or text through your Vercel server to OpenAI only after you choose **Create draft**. The API key stays on the server. This implementation does not write the media to Supabase or Vercel storage or log the request content. The transcript is shown temporarily for review; only the transaction fields you save are persisted. Database usage counters store the account ID, UTC date, and number of attempts, not the media or transcript.

Extraction requests use `store: false`. This is not a promise of zero retention by the provider; OpenAI's applicable retention and abuse-monitoring policies still apply. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data).

## Local development and verification

Copy `.env.example` to `.env` and fill in the two Supabase values plus `OPENAI_API_KEY` and `AI_ALLOWED_EMAILS`. Keep `.env` private and run:

```sh
npm install
npm run dev
```

The development server includes the API route. `npm run preview` only serves the frontend build, so use development mode or your Vercel deployment for live AI.

Automated tests cover the API flow using simulated provider responses, database access and quotas using PostgreSQL, and draft review using the app's actual UI bundle. **Live extraction quality, live provider access, camera behavior, and microphone recording have not been tested with your account or device because no key/device access was supplied.**

After setup, check one receipt and one voice note against the original amount and date. Verify cancelling a draft leaves your transaction history unchanged. On a second account that is not allowlisted, verify smart entry is refused while ordinary money tracking remains available.

## Troubleshooting

| Message or symptom | Fix |
| --- | --- |
| Demo sample only | Sign in to the configured Supabase account. |
| Smart entry needs server setup | Add `OPENAI_API_KEY` and `AI_ALLOWED_EMAILS` to Vercel, then redeploy. |
| Not enabled for this account | Make the allowlist email match your signed-in, confirmed email. |
| Run the smart-entry SQL setup | Run `supabase/smart-entry.sql` in the same Supabase project as the app. |
| AI key needs attention | Check the key, model permissions, and API billing. |
| Daily limit reached | Use manual entry or wait until the next UTC day. |
| Microphone unavailable | Open the HTTPS deployment directly, allow microphone access, or upload/type instead. |
| Upload too large | Use a closer receipt crop or shorter audio clip. |
| Smart entry unavailable here | Ensure `api` and `server` were committed. Use `npm run dev` or Vercel, not a static preview host. |
| A draft is inaccurate | Correct it before saving; try a clearer crop or clearer speech next time. |
