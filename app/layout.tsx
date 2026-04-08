import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
    variable: "--font-geist-sans",
    subsets: ["latin"],
});

const geistMono = Geist_Mono({
    variable: "--font-geist-mono",
    subsets: ["latin"],
});

export const metadata: Metadata = {
    title: "Geo-Bingo", 
    description: "Play Geo-Bingo online for free! Challenge your friends, explore the world, and test your geography skills. Who will get the first bingo?",
    keywords: ["Geo-Bingo", "Geobingo", "Geography Game", "Online Game", "Leonard Sima"], 
    icons: {
        icon: "/mappin.and.ellipse.png",
    },
};

export default function RootLayout({
    children,
}: Readonly<{
  children: React.ReactNode;
}>) {
    return (
        <html
            lang="en"
            className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
        >
            <body className="min-h-full flex flex-col">{children}</body>
        </html>
    );
}
