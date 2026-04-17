import Nav from "../components/Nav";
import Footer from "../components/Footer";
import EmailLinkIsland from "../components/EmailLinkIsland";

export default function Contact() {
  return (
    <div className="content-page">
      <Nav />
      <main className="content-page">
        <div className="page-container">
          <h1 className="page-title">Contact</h1>
          <p className="page-text">
            Have questions about migrare? We'd love to hear from you.
          </p>
          <p className="page-text">
            <EmailLinkIsland />
          </p>
          <p className="page-text t-dim">
            We typically respond within 24-48 hours.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
