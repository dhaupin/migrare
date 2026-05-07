import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

export default function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("Processing...");
  const [error, setError] = useState(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setError(searchParams.get("error_description") || errorParam);
      return;
    }

    if (!code) {
      setError("No authorization code received");
      return;
    }

    // Exchange code for token
    const stateParam = searchParams.get("state");
    console.log("OAUTH callback - code:", code?.slice(0, 8), "state:", stateParam?.slice(0, 20));
    fetch("/api/auth/github/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, state: stateParam }),
    })
      .then((r) => {
        console.log("OAUTH callback - response status:", r.status);
        return r.json();
      })
      .then((d) => {
        console.log("OAUTH callback - response:", d);
        if (d.error) {
          setError(d.error || "Failed to authenticate");
        } else if (d.user) {
          // Store token in sessionStorage
          sessionStorage.setItem("gh_token", d.token || "");
          // Redirect to app
          window.location.href = "/app";
        } else {
          setError("Failed to authenticate");
        }
      })
      .catch((e) => setError(e.message));
  }, [searchParams]);

  if (error) {
    return (
      <div className="app-shell">
        <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
          <div className="text-center">
            <div className="t-red t-lg mb-4">Authentication failed</div>
            <div className="t-dim t-sm mb-4">{error}</div>
            <a href="/app" className="btn btn-primary">Back to app</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <div className="text-center">
          <div className="spinner" style={{ margin: "0 auto 1rem" }}>
            <span className="spinner-ring spinner-ring-lg" />
          </div>
          <div className="t-dim">Connecting to GitHub...</div>
        </div>
      </div>
    </div>
  );
}