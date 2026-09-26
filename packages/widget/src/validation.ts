import { z } from "zod";
import { supportCategories } from "./types";

export const supportFormSchema = z.object({
  category: z.enum(supportCategories, { error: "Choose a topic." }),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a little more (at least 10 characters).")
    .max(10_000, "Keep your message under 10,000 characters."),
  name: z.string().trim().max(120, "Keep your name under 120 characters."),
  email: z.union([
    z.literal(""),
    z.email("Enter a valid email address.").max(320, "Email is too long."),
  ]),
});

export type SupportFormValues = z.infer<typeof supportFormSchema>;
