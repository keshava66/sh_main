import React, { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import jjLogo from "/jj-logo.png";
import "./AboutUs.css";

const DELIVERS = [
  ["Data quality", "Validates data migrations against their source across DEV, QA and PRD environments. Write business or custom rules in plain English, and the SmartHub Data Quality Engine writes the SQL for you and asks for your approval before results are final."],
  ["Fuzzy match", "Searches across connected and catalogued views for a word or value, tolerating typos, and finds matching fields by name. Results narrow by source and export to Excel."],
  ["Explore", "Brings nine regulatory document sets and multiple GRA data domains into one view, with the owner of each domain clearly identified."],
  ["Unstructured strategy", "Extraction, ingestion and vectorization run to each team’s requirements and approvals. Documents like PDFs and images are turned into clean, structured, AI-ready text with tables intact, if any."],
  ["Ask", "Answers questions about regulatory documents in plain English, with every answer cited to its source."],
  ["Govern", "AD group based access control with a full audit trail of every action. Granular, page-level role-based access control is enforced across the entire portal for every request."],
];

const initials = (name) => name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

function Person({ name, role, office }) {
  return (
    <li className="au-person">
      <div className="au-photo" aria-hidden="true">
        {office ? <span className="au-office" /> : initials(name)}
      </div>
      <div className="au-name">{name}</div>
      <div className="au-role">{role}</div>
    </li>
  );
}

// One screen when there is room (wide page, tall enough window): if a column
// still overflows after the CSS scaling, shrink it a step at a time.
// ponytail: linear search, at most ~7 layout passes per resize.
const FIT_MIN_WIDTH = 1101;
const FIT_MIN_HEIGHT = 620;
const MIN_ZOOM = 0.86;

function useFitToScreen(rootRef) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    const host = root?.parentElement;
    if (!root || !host) return undefined;
    const cols = root.querySelectorAll(".au-intro, .au-board");

    const fit = () => {
      const on = host.clientWidth >= FIT_MIN_WIDTH && host.clientHeight >= FIT_MIN_HEIGHT;
      root.classList.toggle("is-fit", on);
      cols.forEach((el) => {
        el.style.zoom = "";
        if (!on) return;
        let z = 1;
        while (el.scrollHeight > el.clientHeight + 1 && z > MIN_ZOOM) {
          z -= 0.02;
          el.style.zoom = String(z);
        }
      });
    };

    fit();
    document.fonts?.ready.then(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [rootRef]);
}

export default function AboutUs() {
  const rootRef = useRef(null);
  useFitToScreen(rootRef);

  return (
    <div className="au" ref={rootRef}>
      <div className="au-page">
        <nav className="au-crumbs" aria-label="Breadcrumb">
          <ol>
            <li><Link to="/dashboard">SmartHub</Link></li>
            <li aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg></li>
            <li><span aria-current="page">About us</span></li>
          </ol>
        </nav>

        <aside className="au-intro">
          <h1>GRA&#8209;SmartHub</h1>
          <p className="au-tagline">Where regulatory data meets intelligence</p>
          <section className="au-block">
            <h2>Our mission</h2>
            <p className="au-mission">Make GRA data easy to find, easy to check and easy to trust.</p>
          </section>
          <section className="au-block">
            <h2>What SmartHub delivers</h2>
            <dl className="au-does">
              {DELIVERS.map(([term, text]) => (
                <div key={term}><dt>{term}:</dt><dd>{text}</dd></div>
              ))}
            </dl>
          </section>
        </aside>

        <section className="au-board" aria-label="The SmartHub team">
          <div className="au-top">
            <section className="au-panel" aria-labelledby="au-owner">
              <h2 className="au-panel-title" id="au-owner">Business owner</h2>
              <ul className="au-row"><Person name="GRA Data Office" role="Regulatory Data Office" office /></ul>
            </section>
            <section className="au-panel" aria-labelledby="au-sponsor">
              <h2 className="au-panel-title" id="au-sponsor">Sponsor</h2>
              <ul className="au-row"><Person name="Steve French" role="JJT IM Regulatory Strategy" /></ul>
            </section>
          </div>

          <section className="au-panel au-core" aria-labelledby="au-core">
            <h2 className="au-panel-title" id="au-core">Core members</h2>
            <div className="au-groups">
              <section className="au-group">
                <div className="au-bar"><h3>GRA Data Office</h3></div>
                <p className="au-sub">Business product leaders</p>
                <div className="au-tree">
                  <ul className="au-row"><Person name="Brian Patti" role="Business Product Manager" /></ul>
                  <div className="au-link split" aria-hidden="true" />
                  <ul className="au-row pair">
                    <Person name="Ruchita Mehta" role="Business Product Owner" />
                    <Person name="Carolina Riso" role="Business Product Owner" />
                  </ul>
                </div>
              </section>
              <section className="au-group">
                <div className="au-bar"><h3>JJT Regulatory Data Intelligence</h3></div>
                <p className="au-sub">Technology product leaders and architecture</p>
                <div className="au-tree">
                  <ul className="au-row pair">
                    <Person name="Mike Martucci" role="Technical Product Owner Manager" />
                    <Person name="Rajan Gadkari" role="Technical Product Owner" />
                  </ul>
                  <div className="au-link join" aria-hidden="true" />
                  <ul className="au-row"><Person name="Dhanumjaya Saggurthi" role="AI Architect" /></ul>
                </div>
              </section>
            </div>
          </section>
        </section>

        <footer className="au-foot">
          <span className="au-logo"><img src={jjLogo} alt="Johnson & Johnson" /></span>
          <span><b>Confidential.</b> For internal J&amp;J use only. Do not share outside the company.</span>
          <span className="au-credit">Built by Team SmartHub</span>
        </footer>
      </div>
    </div>
  );
}
