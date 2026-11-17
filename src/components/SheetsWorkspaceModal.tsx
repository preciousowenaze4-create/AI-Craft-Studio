import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileSpreadsheet,
  LogOut,
  MessageSquarePlus,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  appendRowsToSheet,
  createSpreadsheetWithRows,
  fetchSpreadsheetMetadata,
  getSheetsAccessToken,
  googleSignIn,
  googleSignOut,
  initGoogleAuth,
  readSheetValues,
  type SpreadsheetMetadata,
} from '../services/googleAuth';

interface SheetsWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  pendingExportRows: string[][] | null;
  pendingExportTitle?: string;
  onInjectSheetDataToChat: (text: string) => void;
}

function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

export const SheetsWorkspaceModal: React.FC<SheetsWorkspaceModalProps> = ({
  isOpen,
  onClose,
  pendingExportRows,
  pendingExportTitle = 'Vektor Studio Export',
  onInjectSheetDataToChat,
}) => {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [spreadsheetInput, setSpreadsheetInput] = useState('');
  const [metadata, setMetadata] = useState<SpreadsheetMetadata | null>(null);
  const [selectedTab, setSelectedTab] = useState('');
  const [rangeInput, setRangeInput] = useState('A1:Z50');
  const [loadedRows, setLoadedRows] = useState<string[][]>([]);

  const [newSheetTitle, setNewSheetTitle] = useState(pendingExportTitle);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Explicit user confirmation modal state before mutating/appending data
  const [confirmAction, setConfirmAction] = useState<{
    mode: 'create' | 'append';
    description: string;
    rowsCount: number;
  } | null>(null);

  useEffect(() => {
    setNewSheetTitle(pendingExportTitle);
  }, [pendingExportTitle]);

  useEffect(() => {
    const unsub = initGoogleAuth(
      (authedUser) => {
        setUser(authedUser);
        setNeedsAuth(false);
      },
      () => {
        setNeedsAuth(true);
      }
    );
    return () => unsub();
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setErrorMsg(null);
    try {
      const res = await googleSignIn();
      if (res) {
        setUser(res.user);
        setNeedsAuth(false);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google Sign-In failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = async () => {
    await googleSignOut();
    setUser(null);
    setNeedsAuth(true);
    setMetadata(null);
    setLoadedRows([]);
  };

  const handleLoadSpreadsheet = async () => {
    const token = getSheetsAccessToken();
    if (!token) {
      setNeedsAuth(true);
      return;
    }
    const id = extractSpreadsheetId(spreadsheetInput);
    if (!id) {
      setErrorMsg('Enter a Google Sheets URL or Spreadsheet ID.');
      return;
    }
    setIsBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const meta = await fetchSpreadsheetMetadata(id, token);
      setMetadata(meta);
      const firstTab = meta.sheets[0]?.title || '';
      setSelectedTab(firstTab);
      if (firstTab) {
        const vals = await readSheetValues(
          meta.spreadsheetId,
          `${firstTab}!${rangeInput}`,
          token
        );
        setLoadedRows(vals);
        setStatusMsg(
          `Loaded ${vals.length} rows from "${meta.title}" (${firstTab}).`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load spreadsheet');
    } finally {
      setIsBusy(false);
    }
  };

  const handleReadSelectedTab = async () => {
    const token = getSheetsAccessToken();
    if (!token || !metadata || !selectedTab) return;
    setIsBusy(true);
    setErrorMsg(null);
    try {
      const vals = await readSheetValues(
        metadata.spreadsheetId,
        `${selectedTab}!${rangeInput}`,
        token
      );
      setLoadedRows(vals);
      setStatusMsg(`Loaded ${vals.length} rows from tab "${selectedTab}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to read range');
    } finally {
      setIsBusy(false);
    }
  };

  const executeConfirmedExport = async () => {
    const token = getSheetsAccessToken();
    if (!token || !pendingExportRows || !confirmAction) {
      setConfirmAction(null);
      return;
    }
    setIsBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    setCreatedUrl(null);

    try {
      if (confirmAction.mode === 'create') {
        const created = await createSpreadsheetWithRows(
          newSheetTitle.trim() || 'Vektor Studio Export',
          'Export',
          pendingExportRows,
          token
        );
        setCreatedUrl(created.spreadsheetUrl);
        setStatusMsg(
          `Created spreadsheet with ${pendingExportRows.length} rows.`
        );
      } else if (confirmAction.mode === 'append' && metadata && selectedTab) {
        const result = await appendRowsToSheet(
          metadata.spreadsheetId,
          `${selectedTab}!A1`,
          pendingExportRows,
          token
        );
        setCreatedUrl(metadata.spreadsheetUrl);
        setStatusMsg(
          `Appended ${result.updatedRows} rows to "${metadata.title}" (${selectedTab}).`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google Sheets export failed');
    } finally {
      setIsBusy(false);
      setConfirmAction(null);
    }
  };

  const handleInjectToChat = () => {
    if (loadedRows.length === 0) return;
    const markdownTable = loadedRows
      .slice(0, 40)
      .map((r) => `| ${r.join(' | ')} |`)
      .join('\n');
    const headerSep =
      loadedRows[0]?.length > 0
        ? `| ${loadedRows[0].map(() => '---').join(' | ')} |`
        : '';
    const lines = markdownTable.split('\n');
    const formatted =
      lines.length > 1
        ? [lines[0], headerSep, ...lines.slice(1)].join('\n')
        : markdownTable;

    onInjectSheetDataToChat(
      `Analyze this Google Sheets data from "${metadata?.title || 'Spreadsheet'}" (tab: ${selectedTab}):\n\n${formatted}`
    );
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/75 backdrop-blur-xs">
      <div className="w-full max-w-2xl max-h-[88dvh] rounded-2xl border border-zinc-800 bg-[#111114] flex flex-col overflow-hidden">
        <div className="h-14 px-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Google Sheets Workspace Sync
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 cursor-pointer"
            aria-label="Close Google Sheets Workspace"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {needsAuth ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 flex flex-col items-center text-center space-y-4">
              <FileSpreadsheet className="w-9 h-9 text-emerald-400" />
              <div className="space-y-1">
                <h3 className="text-sm font-semibold text-zinc-100">
                  Connect Google Sheets
                </h3>
                <p className="text-xs text-zinc-400 max-w-md leading-relaxed">
                  Sign in with Google to read live spreadsheet tabs into your AI
                  prompts or export generated tables and place lists directly to
                  Google Sheets.
                </p>
              </div>

              <button
                type="button"
                onClick={handleLogin}
                disabled={isLoggingIn}
                className="gsi-material-button"
              >
                <div className="gsi-material-button-state" />
                <div className="gsi-material-button-content-wrapper">
                  <div className="gsi-material-button-icon">
                    <svg
                      version="1.1"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 48 48"
                      style={{ display: 'block' }}
                    >
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path fill="none" d="M0 0h48v48H0z" />
                    </svg>
                  </div>
                  <span className="gsi-material-button-contents">
                    {isLoggingIn ? 'Signing in...' : 'Sign in with Google'}
                  </span>
                </div>
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border border-zinc-800 bg-zinc-900/50">
                <div className="text-xs text-zinc-300 truncate">
                  Signed in as{' '}
                  <span className="font-semibold text-zinc-100">
                    {user?.email || user?.displayName || 'Google Account'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 cursor-pointer shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign out</span>
                </button>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl border border-red-900/60 bg-red-950/30 text-xs text-red-200">
                  {errorMsg}
                </div>
              )}

              {statusMsg && (
                <div className="p-3 rounded-xl border border-emerald-800/60 bg-emerald-950/30 text-xs text-emerald-200 flex items-center justify-between gap-2">
                  <span>{statusMsg}</span>
                  {createdUrl && (
                    <a
                      href={createdUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold underline shrink-0"
                    >
                      <span>Open Sheet</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              {/* Export Section */}
              {pendingExportRows && pendingExportRows.length > 0 && (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-zinc-100">
                      Ready to Export ({pendingExportRows.length} rows)
                    </h3>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={newSheetTitle}
                      onChange={(e) => setNewSheetTitle(e.target.value)}
                      placeholder="New spreadsheet title"
                      className="flex-1 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        setConfirmAction({
                          mode: 'create',
                          description: `Create a new Google Sheet titled "${newSheetTitle.trim() || 'Vektor Studio Export'}" and write ${pendingExportRows.length} rows into it?`,
                          rowsCount: pendingExportRows.length,
                        })
                      }
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      Create New Sheet
                    </button>
                  </div>

                  {metadata && selectedTab && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        setConfirmAction({
                          mode: 'append',
                          description: `Append ${pendingExportRows.length} rows to existing spreadsheet "${metadata.title}" (tab: "${selectedTab}")?`,
                          rowsCount: pendingExportRows.length,
                        })
                      }
                      className="w-full py-2 px-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-xs font-medium text-emerald-300 cursor-pointer"
                    >
                      Append Rows to &ldquo;{metadata.title}&rdquo; ({selectedTab})
                    </button>
                  )}
                </div>
              )}

              {/* Read Existing Spreadsheet Section */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3.5 space-y-3">
                <h3 className="text-xs font-semibold text-zinc-100">
                  Load Existing Google Sheet
                </h3>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={spreadsheetInput}
                    onChange={(e) => setSpreadsheetInput(e.target.value)}
                    placeholder="Paste Google Sheets URL or Spreadsheet ID..."
                    className="flex-1 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={handleLoadSpreadsheet}
                    className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold cursor-pointer whitespace-nowrap"
                  >
                    {isBusy ? 'Loading...' : 'Fetch Sheet'}
                  </button>
                </div>

                {metadata && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <select
                      value={selectedTab}
                      onChange={(e) => setSelectedTab(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100"
                    >
                      {metadata.sheets.map((s) => (
                        <option key={s.sheetId} value={s.title}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={rangeInput}
                      onChange={(e) => setRangeInput(e.target.value)}
                      className="w-28 px-2.5 py-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-100"
                      placeholder="A1:Z50"
                    />
                    <button
                      type="button"
                      onClick={handleReadSelectedTab}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 cursor-pointer"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Read Range</span>
                    </button>
                  </div>
                )}

                {loadedRows.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="max-h-48 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950">
                      <table className="w-full text-left text-xs border-collapse">
                        <tbody>
                          {loadedRows.slice(0, 20).map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className={`border-b border-zinc-800/70 ${
                                rIdx === 0 ? 'bg-zinc-900 font-semibold text-zinc-200' : 'text-zinc-400'
                              }`}
                            >
                              {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-2.5 py-1.5 whitespace-nowrap tabular-nums">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      type="button"
                      onClick={handleInjectToChat}
                      className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-xs font-medium text-indigo-300 cursor-pointer"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                      <span>Analyze Loaded Sheet Data in AI Chat</span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Mandatory Explicit Confirmation Dialog for Mutating Sheets */}
        {confirmAction && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/75">
            <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-[#18181b] p-5 space-y-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-sm font-semibold text-zinc-100">
                    Confirm Google Sheets Update
                  </h4>
                  <p className="text-xs text-zinc-300 leading-relaxed">
                    {confirmAction.description}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmAction(null)}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={executeConfirmedExport}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isBusy ? 'Writing...' : 'Confirm Write'}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
