import React from "react";
import { createRoot } from "react-dom/client";
import * as amplitude from "@amplitude/unified";
import App from "./App";
import "./styles.css";

const amplitudeApiKey = import.meta.env.VITE_AMPLITUDE_API_KEY;

if (amplitudeApiKey) {
  amplitude.initAll(amplitudeApiKey, {
    analytics: {
      remoteConfig: { fetchRemoteConfig: true }, // remote SDK config from Amplitude
      autocapture: {
        attribution: true,             // UTM / referrer attribution events
        pageViews: true,               // SPA route changes + initial load
        sessions: true,                // Session start / end events
        formInteractions: true,        // Form starts + submits
        fileDownloads: true,           // Downloads of common file types
        elementInteractions: true,     // Click + change on instrumented elements
        frustrationInteractions: true, // Rage clicks, dead clicks
        pageUrlEnrichment: true,       // Adds path / search to event props
        networkTracking: true,         // XHR + fetch request events
        webVitals: true,               // CWV (LCP, INP, CLS) on page hide
      },
    },
    sessionReplay: { sampleRate: 1 }, // Record user sessions; comment out to disable
    engagement: {},                   // In-product Guides & Surveys; comment out to disable
  });
} else {
  console.warn("Amplitude disabled: VITE_AMPLITUDE_API_KEY is not configured.");
}

createRoot(document.getElementById("app")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
