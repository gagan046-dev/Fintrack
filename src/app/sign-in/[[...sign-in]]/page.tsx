import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { isClerkConfigured } from "@/lib/auth-context";

export default function SignInPage() {
  if (!isClerkConfigured()) redirect("/");

  return <main className="auth-page"><SignIn /></main>;
}