import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Instrument_Serif, Space_Grotesk } from "next/font/google";
import "./globals.css";

const displayFont = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
});

const sansFont = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-grotesk",
});

export const metadata: Metadata = {
  title: "ATELIER — Virtual Wardrobe & AI Fashion Stylist",
  description:
    "A zero-cost, zero-trust virtual wardrobe with a Gemini-powered stylist and IDM-VTON virtual fitting room. MongoDB Atlas + Cloudinary, hardened end to end.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${displayFont.variable} ${sansFont.variable}`}>
      <body className="bg-ink font-sans text-ivory antialiased">{children}</body>
    </html>
  );
}
