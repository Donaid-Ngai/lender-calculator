Rental lender calculator with a workbook runner that patches uploaded Excel files, recalculates
them with LibreOffice, and reads mapped output cells.

## Development

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Workbook recalculation

The workbook API route reads formula results from the workbook file. If LibreOffice is not
available, the app falls back to the workbook's cached cell values, which can be stale for
`.xlsm` files until Excel or LibreOffice recalculates them.

For reliable server-side output extraction, run the app in the provided Docker image or on a host
that has both of these binaries available:

- `soffice`
- `python3` with the `uno` module

The route also honors these optional environment variables if you need non-default paths:

- `LIBREOFFICE_PATH`
- `PYTHON_PATH`

## Docker / Coolify

This repo includes a production `Dockerfile` that:

- builds the app with Next.js standalone output
- installs LibreOffice and `python3-uno`
- runs the production server with `node server.js`

Build and run it locally:

```bash
docker build -t lender-calculator .
docker run --rm -p 3000:3000 --env-file .env.local lender-calculator
```

For Coolify:

1. Create an application from this repository.
2. Choose `Dockerfile` as the deployment type.
3. Expose port `3000`.
4. Set the same runtime environment variables you use locally, including Supabase credentials.
5. Deploy.

Coolify is a better fit than Vercel for this workbook flow because the LibreOffice dependency is
part of the image instead of depending on the deployment platform's function environment.
