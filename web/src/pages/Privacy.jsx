import Nav from "../components/Nav";
import Footer from "../components/Footer";

export default function Privacy() {
  return (
    <div className="content-page">
      <Nav />
      <div className="page-container">
        <h1 className="page-title">Privacy Policy</h1>
        <p className="page-text">
          Your privacy is important to us.
        </p>
        <h2 className="page-heading">Data We Collect</h2>
        <p className="page-text">
          migrare processes your project files locally in your browser. We do not store your code on our servers. The only data we receive is anonymized usage analytics.
        </p>
        <h2 className="page-heading">GitHub Access</h2>
        <p className="page-text">
          When you connect your GitHub account, we access only the repositories you explicitly authorize. Your authentication tokens are stored locally in your browser and never transmitted to our servers.
        </p>
        <h2 className="page-heading">Third-Party Services</h2>
        <p className="page-text">
          We use industry-standard hosting (Vercel) and analytics (Vercel Analytics). These services may collect anonymized usage data.
        </p>
        <p className="page-text t-dim">
          Last updated: April 2026
        </p>
      </div>
      <Footer />
    </div>
  );
}
