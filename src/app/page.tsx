import { redirect } from "next/navigation";

/** The start page is the dashboard; the proxy sends signed-out visitors to /login first. */
export default function Home(): never {
  redirect("/dashboard");
}
