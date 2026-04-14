import { useState, useEffect } from "react";
import Nav from "../components/Nav";
import Footer from "../components/Footer";

export default function Contact() {
  const [email, setEmail] = useState("");

  useEffect(() => {
    // Load email via JS to avoid scraping
    setEmail("hello@creadev.org");
  }, []);

  return (
    <div className="page">
      <Nav />
      <main className="main">
        <div className="doc-layout">
          <article className="doc-content">
            <h1>Contact</h1>
            <p className="t-dim">
              Stuck on a migration? Not comfortable doing it yourself? We can help.
            </p>

            <h2>Who we are</h2>
            <p>
              We're <a href="https://creadev.org" target="_blank" rel="noopener noreferrer">Creadev</a>, 
              a small team based in the USA. When you email, you're talking to a real human — not a bot, 
              not an AI. We read every message ourselves.
            </p>

            <h2>How we can help</h2>
            <ul>
              <li>Walk you through a migration step-by-step</li>
              <li>Handle the entire migration for you</li>
              <li>Answer questions about what migrare does</li>
              <li>Help with edge cases we haven't covered yet</li>
            </ul>

            <h2>What to include</h2>
            <p>When you reach out, it helps us help you faster if you include:</p>
            <ul>
              <li>Where your project is now (e.g., Lovable, Bolt, Replit)</li>
              <li>Where you want it to end up (e.g., Vite + React, Next.js)</li>
              <li>Any specific blockers or errors you've run into</li>
              <li>Whether you want to do the migration yourself or have us do it</li>
            </ul>

            <h2>Get in touch</h2>
            <p>
              {email ? (
                <a href={`mailto:${email}`} className="btn btn-primary">
                  {email}
                </a>
              ) : (
                <span>Loading...</span>
              )}
            </p>
            <p className="t-muted t-sm">
              We typically reply within 24-48 hours.
            </p>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}