"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Browser speech-to-text (Chrome, Edge, Android). Free, nothing leaves the
 * browser except the final text the caller chooses to save.
 */
export function useSpeech() {
  // Only rendered after a tap on the client, so window is available.
  const [supported] = useState(
    () => typeof window !== "undefined" && Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition),
  );
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const finalRef = useRef("");

  useEffect(() => {
    return () => recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-IN";
    finalRef.current = "";
    setTranscript("");
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript + " ";
        else interim += r[0].transcript;
      }
      setTranscript((finalRef.current + interim).trim());
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    setListening(true);
    rec.start();
  }, []);

  const stop = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const rec = recRef.current;
      if (!rec) return resolve(finalRef.current.trim());
      rec.onend = () => {
        setListening(false);
        resolve((finalRef.current || "").trim());
      };
      rec.stop();
    });
  }, []);

  return { supported, listening, transcript, start, stop };
}
