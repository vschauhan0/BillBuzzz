// src/pages/_app.jsx
import React from "react";
import dynamic from "next/dynamic";
import Head from "next/head";
import "../../styles/globals.css"; // adjust path if your globals filename differs

// Dynamically import your App component with SSR disabled so react-router is never evaluated on server
const AppClient = dynamic(() => import("../App"), { ssr: false });

// Next will still render other pages normally, but the App with react-router runs only in browser.
export default function MyApp({ Component, pageProps }) {
  // If you also need to render plain Next pages that don't use your App, you can detect that here.
  // For simplicity we mount AppClient and let it handle internal rendering (routes).
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <AppClient Component={Component} pageProps={pageProps} />
    </>
  );
}
