import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognitionInstanceLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstanceLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function joinWithSpacing(base: string, addition: string): string {
  const cleanAdd = addition.trimStart();
  if (!cleanAdd) return base;
  if (!base) return cleanAdd;
  if (/[\s\n]$/.test(base)) return `${base}${cleanAdd}`;
  return `${base} ${cleanAdd}`;
}

export interface UseVoiceInputOptions {
  currentValue: string;
  onChangeValue: (nextValue: string) => void;
  lang?: string;
}

export interface UseVoiceInputResult {
  isSupported: boolean;
  isRecording: boolean;
  voiceError: string | null;
  clearVoiceError: () => void;
  toggleRecording: () => void;
  stopRecording: () => void;
}

export function useVoiceInput({
  currentValue,
  onChangeValue,
  lang,
}: UseVoiceInputOptions): UseVoiceInputResult {
  const [isRecording, setIsRecording] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const isSupported = typeof window !== 'undefined' && getSpeechRecognitionCtor() !== null;

  const recognitionRef = useRef<SpeechRecognitionInstanceLike | null>(null);
  const wantRecordingRef = useRef(false);
  const baseTextRef = useRef('');
  const sessionFinalRef = useRef('');
  const latestValueRef = useRef(currentValue);
  const onChangeRef = useRef(onChangeValue);
  const restartTimerRef = useRef<number | null>(null);

  latestValueRef.current = currentValue;
  onChangeRef.current = onChangeValue;

  const clearRestartTimer = () => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  };

  const cleanupInstance = useCallback((abortFirst: boolean) => {
    clearRestartTimer();
    const rec = recognitionRef.current;
    if (rec) {
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        if (abortFirst) {
          rec.abort();
        } else {
          rec.stop();
        }
      } catch {
        // ignore stop errors when already inactive
      }
      recognitionRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    wantRecordingRef.current = false;
    clearRestartTimer();
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        cleanupInstance(true);
      }
    }
    setIsRecording(false);
  }, [cleanupInstance]);

  const startSession = useCallback(
    (initialBaseText: string) => {
      const Ctor = getSpeechRecognitionCtor();
      if (!Ctor) {
        setVoiceError(
          'Voice dictation is not supported in this browser. Try Chrome or Safari.'
        );
        wantRecordingRef.current = false;
        setIsRecording(false);
        return;
      }

      cleanupInstance(false);

      baseTextRef.current = initialBaseText;
      sessionFinalRef.current = '';

      const recognition = new Ctor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang =
        lang ||
        (typeof navigator !== 'undefined' && navigator.language) ||
        'en-US';

      recognition.onresult = (event) => {
        let finalText = '';
        let interimText = '';

        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result?.[0]?.transcript || '';
          if (result.isFinal) {
            finalText += transcript;
          } else {
            interimText += transcript;
          }
        }

        sessionFinalRef.current = finalText;
        const combinedTranscript = `${finalText}${interimText}`;
        const nextText = joinWithSpacing(baseTextRef.current, combinedTranscript);
        onChangeRef.current(nextText);
      };

      recognition.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') {
          return;
        }
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setVoiceError(
            'Microphone access was blocked. Allow microphone permission in your browser settings.'
          );
          wantRecordingRef.current = false;
          setIsRecording(false);
          cleanupInstance(true);
          return;
        }
        if (event.error === 'audio-capture') {
          setVoiceError('No microphone device was detected.');
          wantRecordingRef.current = false;
          setIsRecording(false);
          cleanupInstance(true);
          return;
        }
        setVoiceError(`Voice recognition error (${event.error}). Tap mic to resume.`);
        wantRecordingRef.current = false;
        setIsRecording(false);
      };

      recognition.onend = () => {
        // Persist whatever was captured in this recognizer cycle into baseTextRef
        const committed = joinWithSpacing(
          baseTextRef.current,
          sessionFinalRef.current
        );
        baseTextRef.current = committed;
        sessionFinalRef.current = '';
        recognitionRef.current = null;

        // Safari / mobile browsers often end continuous recognition on a pause; auto-resume if user did not tap Stop
        if (wantRecordingRef.current) {
          clearRestartTimer();
          restartTimerRef.current = window.setTimeout(() => {
            if (wantRecordingRef.current) {
              startSession(baseTextRef.current);
            }
          }, 120);
        } else {
          setIsRecording(false);
        }
      };

      recognitionRef.current = recognition;

      try {
        recognition.start();
        setVoiceError(null);
        setIsRecording(true);
      } catch (err) {
        recognitionRef.current = null;
        wantRecordingRef.current = false;
        setIsRecording(false);
        setVoiceError(
          err instanceof Error
            ? err.message
            : 'Unable to start voice recording.'
        );
      }
    },
    [cleanupInstance, lang]
  );

  const toggleRecording = useCallback(() => {
    if (!isSupported) {
      setVoiceError(
        'Voice dictation is not supported in this browser. Try Chrome or iOS/macOS Safari.'
      );
      return;
    }

    if (wantRecordingRef.current || isRecording) {
      stopRecording();
      return;
    }

    // Start fresh session preserving all existing text in the box so tapping again continues appending
    wantRecordingRef.current = true;
    startSession(latestValueRef.current);
  }, [isRecording, isSupported, startSession, stopRecording]);

  useEffect(() => {
    return () => {
      wantRecordingRef.current = false;
      cleanupInstance(true);
    };
  }, [cleanupInstance]);

  return {
    isSupported,
    isRecording,
    voiceError,
    clearVoiceError: () => setVoiceError(null),
    toggleRecording,
    stopRecording,
  };
}
