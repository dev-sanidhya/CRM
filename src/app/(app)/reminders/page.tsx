import { redirect } from "next/navigation";

// Callbacks and follow-ups now live on Today, in call order.
export default function RemindersPage() {
  redirect("/today");
}
