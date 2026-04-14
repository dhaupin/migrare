import { useState, useEffect } from "react";

export default function Contact() {
  const [email, setEmail] = useState("");

  useEffect(() => {
    // Obfuscated email - loaded via JS to avoid scraping
    setEmail("hello@creadev.org");
  }, []);

  return (
    <div className="page">
      <div className="page-container">
        <h1 className="page-title">Contact</h1>
        <p className="page-text">
          Have questions about migrare? We'd love to hear from you.
        </p>
        <p className="page-text">
          {email && <a href={`mailto:${email}`}>{email}</a>}
        </p>
        <p className="page-text t-dim">
          We typically respond within 24-48 hours.
        </p>
      </div>
    </div>
  );
}