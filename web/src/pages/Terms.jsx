import Nav from "../components/Nav";
import Footer from "../components/Footer";

export default function Terms() {
  return (
    <div className="content-page">
      <Nav />
      <main className="content-page">
        <div className="page-container">
          <h1 className="page-title">Terms of Service</h1>
          <p className="page-text">
            These Terms of Service ("Terms") govern your use of migrare. By using the site,
            CLI, or API, you agree to these Terms.
          </p>

          <h2 className="page-heading">1. Service Overview</h2>
          <p className="page-text">
            migrare provides tooling that scans exported project files for lock-in signals and
            applies migration transforms. The output is intended to be reviewable and reversible.
          </p>

          <h2 className="page-heading">2. Eligibility and Acceptable Use</h2>
          <p className="page-text">
            You may use migrare only for repositories and files you own or are authorized to modify.
            You agree not to use the service to violate any law, infringe rights, attempt unauthorized
            access, or interfere with platform availability.
          </p>

          <h2 className="page-heading">3. Your Responsibilities</h2>
          <p className="page-text">
            You are responsible for validating migration output before deploying or committing changes.
            You are also responsible for maintaining backups, securing your environment variables, and
            ensuring compatibility with your own infrastructure.
          </p>

          <h2 className="page-heading">4. No Warranty</h2>
          <p className="page-text">
            migrare is provided "as is" and "as available" without warranties of any kind, express or
            implied, including merchantability, fitness for a particular purpose, and non-infringement.
            We do not guarantee uninterrupted service or error-free results.
          </p>

          <h2 className="page-heading">5. Limitation of Liability</h2>
          <p className="page-text">
            To the maximum extent allowed by law, migrare and its maintainers are not liable for any
            indirect, incidental, special, consequential, or punitive damages, or for loss of profits,
            revenue, data, goodwill, or business interruption arising from use of the service.
          </p>

          <h2 className="page-heading">6. Open Source Components</h2>
          <p className="page-text">
            Portions of migrare are distributed under open source licenses, including MIT-licensed
            components. Your use of those components is also subject to their respective license terms.
          </p>

          <h2 className="page-heading">7. Third-Party Platforms</h2>
          <p className="page-text">
            migrare may integrate with third-party services such as GitHub. Your use of those services
            remains governed by their own terms and policies. We are not responsible for third-party
            outages, policy changes, or account actions.
          </p>

          <h2 className="page-heading">8. Changes to These Terms</h2>
          <p className="page-text">
            We may update these Terms from time to time. Material updates will be reflected by a revised
            "Last updated" date on this page. Continued use after updates means you accept the revised Terms.
          </p>

          <h2 className="page-heading">9. Contact</h2>
          <p className="page-text">
            For legal or support questions about these Terms, contact us at{" "}
            <a href="mailto:hello@creadev.org">hello@creadev.org</a>.
          </p>

          <p className="page-text t-dim">Last updated: April 17, 2026</p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
