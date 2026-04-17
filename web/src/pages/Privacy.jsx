import Nav from "../components/Nav";
import Footer from "../components/Footer";
import EmailLinkIsland from "../components/EmailLinkIsland";

export default function Privacy() {
  return (
    <div className="page">
      <Nav />
      <main className="content-page">
        <div className="page-container">
          <h1 className="page-title">Privacy Policy</h1>
          <p className="page-text">
            This Privacy Policy explains what information migrare collects, how it is used, and
            what choices you have.
          </p>

          <h2 className="page-heading">1. What We Process</h2>
          <p className="page-text">
            migrare processes project files that you provide through the web UI, CLI, or API.
            Processing is performed to generate scan reports and migration output. We do not claim
            ownership of your code or repository contents.
          </p>

          <h2 className="page-heading">2. Data Storage and Retention</h2>
          <p className="page-text">
            The migration workflow is designed around minimal retention. In normal operation, files
            are processed in-memory and not stored as persistent user data. Temporary service logs may
            contain operational metadata needed for reliability and abuse prevention.
          </p>

          <h2 className="page-heading">3. Authentication and Tokens</h2>
          <p className="page-text">
            If you authenticate with GitHub, access tokens are used only to perform authorized GitHub
            API actions. Tokens are treated as sensitive credentials and are not intentionally logged
            or persisted in plain text by migrare.
          </p>

          <h2 className="page-heading">4. Analytics and Diagnostics</h2>
          <p className="page-text">
            We may collect basic telemetry such as request counts, error rates, browser type, and
            performance metrics to maintain service health. This data is used for operations and
            product reliability, not for selling personal profiles.
          </p>

          <h2 className="page-heading">5. Cookies and Local Storage</h2>
          <p className="page-text">
            The web app may use local storage for interface preferences (for example, theme selection)
            and short-lived state required for authentication flows.
          </p>

          <h2 className="page-heading">6. Third-Party Services</h2>
          <p className="page-text">
            migrare may rely on infrastructure providers and third-party APIs (including GitHub).
            Those services operate under their own privacy policies and terms.
          </p>

          <h2 className="page-heading">7. Security</h2>
          <p className="page-text">
            We apply reasonable technical and organizational safeguards, but no system can be guaranteed
            100% secure. You are responsible for securing your own devices, accounts, and deployment
            environments.
          </p>

          <h2 className="page-heading">8. Your Rights</h2>
          <p className="page-text">
            Depending on your jurisdiction, you may have rights to access, correct, or delete personal
            information. Contact us to submit privacy-related requests.
          </p>

          <h2 className="page-heading">9. Policy Updates</h2>
          <p className="page-text">
            We may update this Privacy Policy as the product evolves. Changes are reflected on this page
            with an updated effective date.
          </p>

          <h2 className="page-heading">10. Contact</h2>
          <p className="page-text">
            For privacy questions, contact <EmailLinkIsland />.
          </p>

          <p className="page-text t-dim">Last updated: April 17, 2026</p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
