import Nav from "../components/Nav";
import Footer from "../components/Footer";

export default function Privacy() {
  return (
    <div className="page">
      <Nav />
      <main className="main">
        <div className="doc-layout">
          <article className="doc-content">
            <h1>Privacy Policy</h1>

            <p className="t-dim">
              We value your privacy. Here's exactly what we do and don't do with your data.
            </p>

            <h2>We Don't Collect Personal Data</h2>
            <p>
              migrare doesn't require an account. We don't ask for your name, email, or any 
              other personal information to use the tool.
            </p>

            <h2>We Don't Save Your Code</h2>
            <p>
              When you upload a ZIP file, we process it in memory to run the migration. 
              We don't store your project files anywhere. Once the migration is complete 
              and you've downloaded the result, we don't keep a copy.
            </p>

            <h2>No Analytics or Tracking</h2>
            <p>
              We don't use any analytics tools, cookies, or tracking on this website. 
              Your usage is your business.
            </p>

            <h2>GitHub OAuth</h2>
            <p>
              If you use GitHub OAuth to migrate a repository directly, migrare requests 
              only the permissions it needs (repo read/write). We don't store your GitHub 
              token — it stays in your browser and is used only for the migration.
            </p>

            <h2>No Selling of Data</h2>
            <p>
              We don't sell, rent, or give away any data. Because we don't collect it, 
              there's nothing to sell.
            </p>

            <h2>Server Logs</h2>
            <p>
              Like any web service, our server logs basic information like your IP address 
              and browser type. This is standard for web hosting and is not used to identify you.
            </p>

            <h2>Changes to This Policy</h2>
            <p>
              If we change this privacy policy, we'll update the date below. This policy 
              is as straightforward as we can make it.
            </p>

            <p className="t-muted t-sm" style={{ marginTop: "2rem" }}>
              Last updated: {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}