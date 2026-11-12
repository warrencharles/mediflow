import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Info, X, UploadCloud, ArrowLeft, MoreVertical } from 'lucide-react';

const UICtx = createContext(null);

/**
 * Full-viewport Portal Modal that renders directly into document.body
 * so it is never clipped or trapped inside any parent container, and
 * scrolls cleanly when content is taller than the screen.
 */
export function Modal({ open, onClose, title, subtitle, maxWidth = 'max-w-lg', children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="no-print fixed inset-0 z-[85] overflow-y-auto bg-slate-950/60 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) onClose();
      }}
    >
      <div
        className="flex min-h-full items-center justify-center p-4 sm:p-6"
        onClick={(e) => {
          if (e.target === e.currentTarget && onClose) onClose();
        }}
      >
        <div
          className={`animate-modal bg-white rounded-2xl shadow-2xl border border-slate-200 w-full ${maxWidth} overflow-hidden text-xs my-6`}
        >
          {title && (
            <div className="px-6 py-4 bg-slate-50/80 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-bold text-base text-slate-900">{title}</h2>
                {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
              </div>
              {onClose && (
                <button
                  type="button"
                  onClick={onClose}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition"
                  title="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
          <div className="p-6 space-y-4">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);

  const toast = useCallback((message, type = 'success', title = '') => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type, title }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  /**
   * Opens a styled confirmation/prompt modal instead of browser alert/prompt.
   * Usage:
   *   const res = await confirm({ title, message, confirmText, danger, requireInput, inputPlaceholder });
   *   if (!res) return; // cancelled
   *   // if requireInput is true, res is the entered string; otherwise true
   */
  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      setConfirmState({
        title: opts.title || 'Confirm Action',
        message: opts.message || 'Are you sure you want to proceed?',
        confirmText: opts.confirmText || 'Confirm',
        cancelText: opts.cancelText || 'Cancel',
        danger: !!opts.danger,
        requireInput: !!opts.requireInput,
        inputLabel: opts.inputLabel || 'Reason / Note *',
        inputPlaceholder: opts.inputPlaceholder || 'Enter reason…',
        inputValue: opts.defaultValue || '',
        resolve,
      });
    });
  }, []);

  const closeConfirm = (result) => {
    if (confirmState?.resolve) confirmState.resolve(result);
    setConfirmState(null);
  };

  return (
    <UICtx.Provider value={{ toast, confirm }}>
      {children}

      {/* Sliding Toast Stack */}
      <div className="no-print fixed top-4 right-4 z-[90] flex flex-col gap-2.5 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => {
          const styles =
            t.type === 'error'
              ? 'bg-rose-950/95 border-rose-500 text-rose-50'
              : t.type === 'warning'
                ? 'bg-amber-950/95 border-amber-500 text-amber-50'
                : 'bg-slate-900/95 border-teal-400 text-white';
          const Icon = t.type === 'error' ? AlertTriangle : t.type === 'warning' ? Info : CheckCircle2;
          return (
            <div
              key={t.id}
              className={`animate-toast pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border-l-4 shadow-xl backdrop-blur ${styles}`}
            >
              <Icon className="w-5 h-5 shrink-0 mt-0.5 text-teal-400" />
              <div className="flex-1 text-xs leading-relaxed">
                {t.title && <div className="font-bold mb-0.5">{t.title}</div>}
                <div>{t.message}</div>
              </div>
              <button onClick={() => dismissToast(t.id)} className="opacity-60 hover:opacity-100">
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirmation / Prompt Modal */}
      {confirmState && (
        <div className="no-print fixed inset-0 z-[95] bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="animate-modal bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div
                className={`p-2.5 rounded-xl shrink-0 ${confirmState.danger ? 'bg-rose-100 text-rose-700' : 'bg-teal-100 text-teal-700'
                  }`}
              >
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">{confirmState.title}</h3>
                <p className="text-slate-600 leading-relaxed">{confirmState.message}</p>
              </div>
            </div>

            {confirmState.requireInput && (
              <div>
                <label className="block font-semibold text-slate-700 mb-1">{confirmState.inputLabel}</label>
                <input
                  autoFocus
                  value={confirmState.inputValue}
                  onChange={(e) => setConfirmState({ ...confirmState, inputValue: e.target.value })}
                  placeholder={confirmState.inputPlaceholder}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 outline-none"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => closeConfirm(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
              >
                {confirmState.cancelText}
              </button>
              <button
                type="button"
                disabled={confirmState.requireInput && confirmState.inputValue.trim().length < 3}
                onClick={() =>
                  closeConfirm(confirmState.requireInput ? confirmState.inputValue.trim() : true)
                }
                className={`px-4 py-2 rounded-lg text-white font-semibold transition disabled:opacity-40 ${confirmState.danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-teal-600 hover:bg-teal-700'
                  }`}
              >
                {confirmState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </UICtx.Provider>
  );
}

export const useUI = () => useContext(UICtx);

/**
 * Reusable Upload Dropzone with real XHR upload progress bar.
 */
export function UploadProgressBox({ url, fieldName = 'file', extraFields = {}, accept, label, onSuccess, onError }) {
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    setUploading(true);
    setProgress(5);

    const fd = new FormData();
    Object.entries(extraFields).forEach(([k, v]) => {
      if (v !== undefined && v !== null) fd.append(k, String(v));
    });
    fd.append(fieldName, file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url.startsWith('/api') ? url : `/api${url}`, true);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      setUploading(false);
      let resp = null;
      try {
        resp = JSON.parse(xhr.responseText);
      } catch { }
      if (xhr.status >= 200 && xhr.status < 300) {
        setProgress(100);
        onSuccess && onSuccess(resp);
      } else {
        setProgress(0);
        onError && onError(new Error(resp?.error || 'Upload failed'));
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setProgress(0);
      onError && onError(new Error('Network error during upload'));
    };
    xhr.send(fd);
  };

  return (
    <div className="space-y-2">
      <label className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border-2 border-dashed border-slate-300 hover:border-teal-500 bg-slate-50/70 cursor-pointer transition">
        <div className="flex items-center gap-2.5 text-xs">
          <UploadCloud className="w-4 h-4 text-teal-600 shrink-0" />
          <span className="font-medium text-slate-700">
            {fileName ? `Selected: ${fileName}` : label || 'Choose file to upload…'}
          </span>
        </div>
        <span className="px-2.5 py-1 rounded bg-white border text-[11px] font-semibold text-slate-700">Browse</span>
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </label>

      {(uploading || progress === 100) && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] font-semibold text-slate-600">
            <span>{uploading ? 'Uploading…' : 'Upload complete'}</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-600 transition-all duration-200 rounded-full"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * History-aware Back Button that remembers the exact previous path, tab, and filter
 * instead of jumping to a hardcoded list page.
 */
export function BackButton({ fallback = '/', label = 'Back', className = '' }) {
  const nav = useNavigate();
  const loc = useLocation();

  const handleBack = () => {
    if (loc.state?.from) {
      nav(loc.state.from);
    } else if (window.history.state && typeof window.history.state.idx === 'number' && window.history.state.idx > 0) {
      nav(-1);
    } else if (window.history.length > 2) {
      nav(-1);
    } else {
      nav(fallback);
    }
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-teal-700 transition shadow-2xs ${className}`}
    >
      <ArrowLeft className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );
}

/**
 * Responsive Action Menu that keeps small screens uncluttered by collapsing
 * secondary row/header actions into a clean Portal dropdown while keeping
 * the primary action one click away.
 */
export function ActionMenu({ primary, items = [], alwaysCollapse = false, label = 'Actions' }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);

  const validItems = items.filter(Boolean);

  const toggle = (e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuWidth = 195;
      const left = Math.max(12, Math.min(window.innerWidth - menuWidth - 12, rect.right - menuWidth));
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < 220 ? Math.max(12, rect.top - Math.min(220, validItems.length * 36 + 16)) : rect.bottom + 6;
      setCoords({ top, left });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (!validItems.length) {
    return <div className="inline-flex items-center justify-end gap-1.5">{primary}</div>;
  }

  const toneBtnClass = (it) => {
    if (it.danger) return 'border-rose-200 text-rose-700 hover:bg-rose-50 bg-white';
    if (it.tone === 'amber') return 'border-amber-200 text-amber-800 hover:bg-amber-50 bg-white';
    if (it.tone === 'teal') return 'border-teal-200 text-teal-800 hover:bg-teal-50 bg-white';
    if (it.tone === 'indigo') return 'border-indigo-200 text-indigo-800 hover:bg-indigo-50 bg-white';
    return 'border-slate-300 text-slate-700 hover:bg-slate-50 bg-white';
  };

  return (
    <div className="inline-flex items-center justify-end gap-1.5 flex-wrap">
      {primary}

      {/* On large desktop screens, show inline buttons only when not alwaysCollapse and <= 2 items */}
      {!alwaysCollapse && validItems.length <= 2 && (
        <div className="hidden xl:inline-flex items-center gap-1.5">
          {validItems.map((it, idx) =>
            it.to ? (
              <Link
                key={idx}
                to={it.to}
                className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition ${toneBtnClass(it)}`}
              >
                {it.label}
              </Link>
            ) : (
              <button
                key={idx}
                type="button"
                disabled={it.disabled}
                onClick={it.onClick}
                className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition disabled:opacity-40 ${toneBtnClass(it)}`}
              >
                {it.label}
              </button>
            ),
          )}
        </div>
      )}

      {/* Compact menu trigger (always visible on smaller screens, or on all screens when >2 actions / alwaysCollapse) */}
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title={label}
        className={`${!alwaysCollapse && validItems.length <= 2 ? 'xl:hidden' : ''
          } inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 text-xs font-semibold transition`}
      >
        <span className="hidden sm:inline text-[11px]">{label}</span>
        <MoreVertical className="w-3.5 h-3.5 text-slate-500" />
      </button>

      {open &&
        createPortal(
          <div
            style={{ top: coords.top, left: coords.left }}
            onClick={(e) => e.stopPropagation()}
            className="no-print fixed z-[92] w-48 rounded-xl bg-white shadow-xl border border-slate-200 py-1.5 text-xs animate-modal"
          >
            {validItems.map((it, idx) =>
              it.to ? (
                <Link
                  key={idx}
                  to={it.to}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2 w-full text-left px-3.5 py-2 font-medium transition ${it.danger ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-100'
                    }`}
                >
                  {it.label}
                </Link>
              ) : (
                <button
                  key={idx}
                  type="button"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onClick && it.onClick();
                  }}
                  className={`flex items-center gap-2 w-full text-left px-3.5 py-2 font-medium transition disabled:opacity-40 ${it.danger
                      ? 'text-rose-700 hover:bg-rose-50'
                      : it.tone === 'amber'
                        ? 'text-amber-800 hover:bg-amber-50'
                        : it.tone === 'teal'
                          ? 'text-teal-800 hover:bg-teal-50'
                          : 'text-slate-700 hover:bg-slate-100'
                    }`}
                >
                  {it.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

