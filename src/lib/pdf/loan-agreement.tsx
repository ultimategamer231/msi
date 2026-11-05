import "server-only";

/* eslint-disable jsx-a11y/alt-text -- react-pdf <Image> is drawn into the PDF and has no alt attribute. */

import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/*
 * Loan agreement, A4 (SPEC 10.1; FR-25): company header, number, generation time, preparer, QR code
 * to /verify/<token>, parties, amount, interest, term, due date, penalty terms in plain language
 * (placeholder legal text from settings.templates), collateral, guarantors and signature blocks.
 * All amounts arrive already formatted; this file only lays them out.
 */
export type AgreementLabels = Record<
  | "title"
  | "loanLine"
  | "parties"
  | "lender"
  | "borrower"
  | "borrowerId"
  | "borrowerPhone"
  | "borrowerAddress"
  | "branch"
  | "loan"
  | "principal"
  | "interest"
  | "total"
  | "term"
  | "dueDate"
  | "product"
  | "purpose"
  | "terms"
  | "collateral"
  | "item"
  | "description"
  | "identifier"
  | "value"
  | "guarantors"
  | "none"
  | "signBorrower"
  | "signGuarantor"
  | "signCompany"
  | "dateLine"
  | "preparedBy"
  | "verify",
  string
>;

export interface AgreementData {
  company: { name: string; address: string; phone: string; email: string; logo: Buffer | null };
  number: string;
  generatedAt: string;
  preparedBy: string;
  qrDataUrl: string;
  verifyUrl: string;
  loan: {
    loanNo: string;
    product: string;
    branch: string;
    officer: string;
    principal: string;
    interest: string;
    total: string;
    rate: string;
    term: string;
    dueDate: string;
    purpose: string;
  };
  borrower: { name: string; code: string; id: string; phone: string; address: string };
  terms: string;
  collateral: Array<{ code: string; description: string; identifier: string; value: string }>;
  guarantors: Array<{ name: string; relationship: string; phone: string; id: string }>;
  labels: AgreementLabels;
}

const colors = { primary: "#32207E", ink: "#0F172A", muted: "#475569", line: "#CBD5E1", tint: "#F1F5F9" };

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, color: colors.ink, fontFamily: "Helvetica", lineHeight: 1.4 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 46, height: 46, objectFit: "contain" },
  company: { fontSize: 13, fontFamily: "Helvetica-Bold", color: colors.primary },
  muted: { color: colors.muted },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  section: { marginTop: 12 },
  heading: { fontSize: 10.5, fontFamily: "Helvetica-Bold", color: colors.primary, marginBottom: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "50%", marginBottom: 4 },
  label: { fontSize: 8, color: colors.muted },
  value: { fontFamily: "Helvetica-Bold" },
  box: { backgroundColor: colors.tint, padding: 8, borderRadius: 4 },
  table: { borderTopWidth: 1, borderColor: colors.line },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 4 },
  th: { fontSize: 8, color: colors.muted, fontFamily: "Helvetica-Bold" },
  signatures: { flexDirection: "row", gap: 18, marginTop: 28 },
  signature: { flex: 1, borderTopWidth: 1, borderColor: colors.ink, paddingTop: 4 },
  footer: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  qr: { width: 64, height: 64 },
});

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function Agreement({ data }: { data: AgreementData }) {
  const l = data.labels;
  return (
    <Document title={`${l.title} ${data.number}`} author={data.company.name} subject={data.loan.loanNo}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.brand}>
            {data.company.logo !== null ? <Image src={data.company.logo} style={styles.logo} /> : null}
            <View>
              <Text style={styles.company}>{data.company.name}</Text>
              {[data.company.address, data.company.phone, data.company.email]
                .filter((part) => part !== "")
                .map((part) => (
                  <Text key={part} style={styles.muted}>
                    {part}
                  </Text>
                ))}
            </View>
          </View>
          <View>
            <Text style={styles.value}>{data.number}</Text>
            <Text style={styles.muted}>{data.generatedAt}</Text>
          </View>
        </View>

        <Text style={styles.title}>{l.title}</Text>
        <Text style={styles.muted}>{l.loanLine}</Text>

        <View style={styles.section}>
          <Text style={styles.heading}>{l.parties}</Text>
          <View style={styles.grid}>
            <Detail label={l.lender} value={data.company.name} />
            <Detail label={l.borrower} value={`${data.borrower.name} (${data.borrower.code})`} />
            <Detail label={l.borrowerId} value={data.borrower.id} />
            <Detail label={l.borrowerPhone} value={data.borrower.phone} />
            <Detail label={l.borrowerAddress} value={data.borrower.address} />
            <Detail label={l.branch} value={`${data.loan.branch} · ${data.loan.officer}`} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>{l.loan}</Text>
          <View style={[styles.grid, styles.box]}>
            <Detail label={l.principal} value={data.loan.principal} />
            <Detail label={l.interest} value={`${data.loan.interest} (${data.loan.rate})`} />
            <Detail label={l.total} value={data.loan.total} />
            <Detail label={l.term} value={data.loan.term} />
            <Detail label={l.dueDate} value={data.loan.dueDate} />
            <Detail label={l.product} value={data.loan.product} />
            {data.loan.purpose !== "" ? <Detail label={l.purpose} value={data.loan.purpose} /> : null}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>{l.terms}</Text>
          <Text>{data.terms}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>{l.collateral}</Text>
          {data.collateral.length === 0 ? (
            <Text style={styles.muted}>{l.none}</Text>
          ) : (
            <View style={styles.table}>
              <View style={styles.row}>
                <Text style={[styles.th, { width: "18%" }]}>{l.item}</Text>
                <Text style={[styles.th, { width: "42%" }]}>{l.description}</Text>
                <Text style={[styles.th, { width: "22%" }]}>{l.identifier}</Text>
                <Text style={[styles.th, { width: "18%", textAlign: "right" }]}>{l.value}</Text>
              </View>
              {data.collateral.map((item) => (
                <View key={item.code} style={styles.row}>
                  <Text style={{ width: "18%" }}>{item.code}</Text>
                  <Text style={{ width: "42%" }}>{item.description}</Text>
                  <Text style={{ width: "22%" }}>{item.identifier}</Text>
                  <Text style={{ width: "18%", textAlign: "right" }}>{item.value}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>{l.guarantors}</Text>
          {data.guarantors.length === 0 ? (
            <Text style={styles.muted}>{l.none}</Text>
          ) : (
            data.guarantors.map((guarantor) => (
              <Text key={`${guarantor.name}-${guarantor.phone}`}>
                {[guarantor.name, guarantor.relationship, guarantor.phone, guarantor.id]
                  .filter((part) => part !== "")
                  .join(" · ")}
              </Text>
            ))
          )}
        </View>

        <View style={styles.signatures} wrap={false}>
          <View style={styles.signature}>
            <Text>{l.signBorrower}</Text>
            <Text style={styles.muted}>{data.borrower.name}</Text>
          </View>
          {data.guarantors.map((guarantor) => (
            <View key={`sign-${guarantor.name}`} style={styles.signature}>
              <Text>{l.signGuarantor}</Text>
              <Text style={styles.muted}>{guarantor.name}</Text>
            </View>
          ))}
          <View style={styles.signature}>
            <Text>{l.signCompany}</Text>
            <Text style={styles.muted}>{data.company.name}</Text>
          </View>
        </View>
        <Text style={[styles.muted, { marginTop: 8 }]}>{l.dateLine}</Text>

        <View style={styles.footer} fixed>
          <View>
            <Text style={styles.muted}>{l.preparedBy}</Text>
            <Text style={styles.muted}>{l.verify}</Text>
            <Text style={styles.muted}>{data.verifyUrl}</Text>
          </View>
          <Image src={data.qrDataUrl} style={styles.qr} />
        </View>
      </Page>
    </Document>
  );
}

export function renderLoanAgreement(data: AgreementData): Promise<Buffer> {
  return renderToBuffer(<Agreement data={data} />);
}
