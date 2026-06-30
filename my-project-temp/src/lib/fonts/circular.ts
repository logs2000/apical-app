import localFont from "next/font/local";

export const circularStd = localFont({
  src: [
    {
      path: "../../fonts/CircularStd-Book.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/CircularStd-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../fonts/CircularStd-Bold.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../fonts/CircularStd-Black.woff2",
      weight: "900",
      style: "normal",
    },
  ],
  variable: "--font-circular-std",
  display: "swap",
});
