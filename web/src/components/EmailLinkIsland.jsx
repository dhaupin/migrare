import { useEffect, useState } from "react";

const USER_PARTS = ["he", "llo"];
const DOMAIN_PARTS = ["crea", "dev.org"];

export default function EmailLinkIsland() {
  const [email, setEmail] = useState("");

  useEffect(() => {
    setEmail(`${USER_PARTS.join("")}@${DOMAIN_PARTS.join("")}`);
  }, []);

  if (!email) return null;

  return <a href={`mailto:${email}`}>{email}</a>;
}
