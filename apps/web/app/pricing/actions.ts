"use server";

import { prisma } from "@/lib/prisma";

export interface WaitlistState {
  error?: string;
  success?: boolean;
}

export async function joinWaitlist(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const raw = formData.get("email");
  const email = typeof raw === "string" ? raw.toLowerCase().trim() : "";
  const name =
    typeof formData.get("name") === "string"
      ? (formData.get("name") as string).trim() || null
      : null;
  const plan = formData.get("plan") as string;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter a valid email address." };
  }
  if (!["pro", "teams"].includes(plan)) {
    return { error: "Invalid plan selection." };
  }

  try {
    await prisma.waitlistEntry.upsert({
      where: { email_plan: { email, plan } },
      update: { name },
      create: { email, name, plan },
    });
    return { success: true };
  } catch (err) {
    console.error("[waitlist] upsert failed:", err);
    return { error: "Something went wrong. Please try again." };
  }
}
