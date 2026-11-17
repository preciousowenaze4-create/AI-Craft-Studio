import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
export const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
] as const;

for (const scope of SHEETS_SCOPES) {
  provider.addScope(scope);
}

let isSigningIn = false;
// Strictly in-memory token cache (never stored in localStorage/sessionStorage)
let cachedAccessToken: string | null = null;

export const initGoogleAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      if (!user) cachedAccessToken = null;
      onAuthFailure?.();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to obtain Google Sheets access token');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
};

export const getSheetsAccessToken = (): string | null => cachedAccessToken;

export const googleSignOut = async (): Promise<void> => {
  await auth.signOut();
  cachedAccessToken = null;
};

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string;
  sheets: Array<{ sheetId: number; title: string }>;
}

export async function fetchSpreadsheetMetadata(
  spreadsheetId: string,
  accessToken: string
): Promise<SpreadsheetMetadata> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties(sheetId,title)`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google Sheets API error (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
    properties?: { title?: string };
    sheets?: Array<{ properties?: { sheetId?: number; title?: string } }>;
  };

  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || 'Untitled Spreadsheet',
    spreadsheetUrl: data.spreadsheetUrl,
    sheets: (data.sheets || []).map((s, idx) => ({
      sheetId: s.properties?.sheetId ?? idx,
      title: s.properties?.title || `Sheet${idx + 1}`,
    })),
  };
}

export async function readSheetValues(
  spreadsheetId: string,
  range: string,
  accessToken: string
): Promise<string[][]> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Unable to read sheet range (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { values?: string[][] };
  return data.values || [];
}

export async function createSpreadsheetWithRows(
  title: string,
  sheetTitle: string,
  rows: string[][],
  accessToken: string
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
      sheets: [{ properties: { title: sheetTitle } }],
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create spreadsheet (${createRes.status}): ${errText}`);
  }

  const created = (await createRes.json()) as {
    spreadsheetId: string;
    spreadsheetUrl: string;
  };

  if (rows.length > 0) {
    await appendRowsToSheet(
      created.spreadsheetId,
      `${sheetTitle}!A1`,
      rows,
      accessToken
    );
  }

  return created;
}

export async function appendRowsToSheet(
  spreadsheetId: string,
  range: string,
  rows: string[][],
  accessToken: string
): Promise<{ updatedRows: number }> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: rows }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to append rows (${res.status}): ${errText}`);
  }
  const data = (await res.json()) as { updates?: { updatedRows?: number } };
  return { updatedRows: data.updates?.updatedRows ?? rows.length };
}
