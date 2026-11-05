use near_sdk::store::{IterableSet, LookupMap, LookupSet, Vector};
use near_sdk::{env, near, AccountId, BorshStorageKey, NearToken, PanicOnDefault};

const OPEN_DEPOSIT: NearToken = NearToken::from_yoctonear(10_000_000_000_000_000_000); // 0.01 NEAR

#[derive(BorshStorageKey)]
#[near]
enum Keys {
    Signers,
    Allowlist,
    Receipts,
    Seen,
    CaseIndex,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum ReceiptKind {
    Finding,
    Open,
    OpenDenied,
    Approval,
    Rejection,
    CustodyCheck,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum Verdict {
    Accept,
    Flag,
    Block,
    Hold,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum TcbStatus {
    UpToDate,
    Other,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct SignedFinding {
    pub model_id: String,
    pub request_hash: [u8; 32],
    pub response_hash: [u8; 32],
    pub signature: Vec<u8>,
    pub signer_pubkey: [u8; 32],
    pub gateway_report_hash: [u8; 32],
    pub model_report_hash: [u8; 32],
    pub nonce: [u8; 32],
    pub tcb_status: TcbStatus,
    pub finding_hash: [u8; 32],
    pub citation_hashes: Vec<[u8; 32]>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Receipt {
    pub id: u64,
    pub case_id: String,
    pub kind: ReceiptKind,
    pub actor: AccountId,
    pub evidence_commitments: Vec<[u8; 32]>,
    pub finding: Option<SignedFinding>,
    pub policy_verdict: Option<Verdict>,
    pub reason: Option<String>,
    pub prev_hash: [u8; 32],
    pub timestamp_ns: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CustodyContract {
    owner: AccountId,
    writer: AccountId,
    approved_signers: IterableSet<[u8; 32]>,
    allowlist: LookupMap<String, Vec<AccountId>>,
    receipts: Vector<Receipt>,
    seen_responses: LookupSet<[u8; 32]>,
    case_index: LookupMap<String, Vec<u64>>,
}

#[near]
impl CustodyContract {
    #[init]
    pub fn new(owner: AccountId, writer: AccountId) -> Self {
        Self {
            owner,
            writer,
            approved_signers: IterableSet::new(Keys::Signers),
            allowlist: LookupMap::new(Keys::Allowlist),
            receipts: Vector::new(Keys::Receipts),
            seen_responses: LookupSet::new(Keys::Seen),
            case_index: LookupMap::new(Keys::CaseIndex),
        }
    }

    pub fn add_signer(&mut self, pubkey: [u8; 32]) {
        self.require_owner();
        self.approved_signers.insert(pubkey);
    }

    pub fn remove_signer(&mut self, pubkey: [u8; 32]) {
        self.require_owner();
        self.approved_signers.remove(&pubkey);
    }

    pub fn grant(&mut self, case_id: String, account: AccountId) {
        self.require_owner();
        let mut list = self.allowlist.remove(&case_id).unwrap_or_default();
        if !list.contains(&account) {
            list.push(account);
        }
        self.allowlist.insert(case_id, list);
    }

    pub fn revoke(&mut self, case_id: String, account: AccountId) {
        self.require_owner();
        let mut list = self.allowlist.remove(&case_id).unwrap_or_default();
        list.retain(|a| a != &account);
        self.allowlist.insert(case_id, list);
    }

    pub fn record_finding(
        &mut self,
        case_id: String,
        evidence_commitments: Vec<[u8; 32]>,
        finding: SignedFinding,
        verdict: Verdict,
    ) {
        assert_eq!(env::predecessor_account_id(), self.writer, "only writer");
        assert!(
            self.approved_signers.contains(&finding.signer_pubkey),
            "signer not approved"
        );
        if verdict != Verdict::Block {
            assert!(
                !finding.citation_hashes.is_empty(),
                "citations required unless BLOCK"
            );
        }
        assert!(
            !self.seen_responses.contains(&finding.response_hash),
            "replayed response"
        );

        assert_eq!(finding.signature.len(), 64, "signature must be 64 bytes");
        let mut sig = [0u8; 64];
        sig.copy_from_slice(&finding.signature);
        let text = signed_text(&finding.model_id, &finding.request_hash, &finding.response_hash);
        assert!(
            env::ed25519_verify(&sig, text.as_bytes(), &finding.signer_pubkey),
            "ed25519_verify failed"
        );

        self.seen_responses.insert(finding.response_hash);
        self.push_receipt(Receipt {
            id: 0,
            case_id,
            kind: ReceiptKind::Finding,
            actor: env::predecessor_account_id(),
            evidence_commitments,
            finding: Some(finding),
            policy_verdict: Some(verdict),
            reason: None,
            prev_hash: self.prev_hash(),
            timestamp_ns: env::block_timestamp(),
        });
    }

    pub fn record_custody_check(
        &mut self,
        case_id: String,
        evidence_commitment: [u8; 32],
        expected_receipt_id: u64,
        matched: bool,
    ) {
        assert_eq!(env::predecessor_account_id(), self.writer, "only writer");
        self.push_receipt(Receipt {
            id: 0,
            case_id,
            kind: ReceiptKind::CustodyCheck,
            actor: env::predecessor_account_id(),
            evidence_commitments: vec![evidence_commitment],
            finding: None,
            policy_verdict: if matched {
                Some(Verdict::Accept)
            } else {
                Some(Verdict::Block)
            },
            reason: Some(format!("expected_receipt_id={expected_receipt_id}")),
            prev_hash: self.prev_hash(),
            timestamp_ns: env::block_timestamp(),
        });
    }

    #[payable]
    pub fn request_open(&mut self, case_id: String, evidence_id: String, reason: String) -> bool {
        assert!(
            env::attached_deposit() >= OPEN_DEPOSIT,
            "attach deposit"
        );
        let allowed = self
            .allowlist
            .get(&case_id)
            .map(|s| s.contains(&env::predecessor_account_id()))
            .unwrap_or(false);
        let kind = if allowed {
            ReceiptKind::Open
        } else {
            ReceiptKind::OpenDenied
        };
        self.push_receipt(Receipt {
            id: 0,
            case_id,
            kind,
            actor: env::predecessor_account_id(),
            evidence_commitments: vec![],
            finding: None,
            policy_verdict: None,
            reason: Some(format!("{evidence_id}:{reason}")),
            prev_hash: self.prev_hash(),
            timestamp_ns: env::block_timestamp(),
        });
        allowed
    }

    pub fn approve_action(
        &mut self,
        case_id: String,
        receipt_id: u64,
        decision: bool,
        reason: String,
    ) {
        self.require_owner();
        self.push_receipt(Receipt {
            id: 0,
            case_id,
            kind: if decision {
                ReceiptKind::Approval
            } else {
                ReceiptKind::Rejection
            },
            actor: env::predecessor_account_id(),
            evidence_commitments: vec![],
            finding: None,
            policy_verdict: None,
            reason: Some(format!("receipt={receipt_id}:{reason}")),
            prev_hash: self.prev_hash(),
            timestamp_ns: env::block_timestamp(),
        });
    }

    pub fn get_receipt(&self, id: u64) -> Option<Receipt> {
        self.receipts.get(id as u32).cloned()
    }

    pub fn get_case_receipts(&self, case_id: String, from: u64, limit: u64) -> Vec<Receipt> {
        let Some(idx) = self.case_index.get(&case_id) else {
            return vec![];
        };
        let mut out = Vec::new();
        let end = std::cmp::min(from.saturating_add(limit) as usize, idx.len());
        for i in from as usize..end {
            let rid = idx[i];
            if let Some(r) = self.receipts.get(rid as u32) {
                out.push(r.clone());
            }
        }
        out
    }

    pub fn is_grantee(&self, case_id: String, account: AccountId) -> bool {
        self.allowlist
            .get(&case_id)
            .map(|s| s.contains(&account))
            .unwrap_or(false)
    }

    pub fn receipt_count(&self) -> u64 {
        self.receipts.len() as u64
    }
}

impl CustodyContract {
    fn require_owner(&self) {
        assert_eq!(env::predecessor_account_id(), self.owner, "only owner");
    }

    fn prev_hash(&self) -> [u8; 32] {
        if self.receipts.is_empty() {
            return [0u8; 32];
        }
        let last = self.receipts.get(self.receipts.len() - 1).unwrap();
        env::sha256_array(&borsh_id(last.id))
    }

    fn push_receipt(&mut self, mut r: Receipt) {
        let id = self.receipts.len() as u64;
        r.id = id;
        self.receipts.push(r.clone());
        let mut idx = self.case_index.remove(&r.case_id).unwrap_or_default();
        idx.push(id);
        self.case_index.insert(r.case_id, idx);
    }
}

fn borsh_id(id: u64) -> Vec<u8> {
    id.to_le_bytes().to_vec()
}

pub fn signed_text(model_id: &str, request_hash: &[u8; 32], response_hash: &[u8; 32]) -> String {
    format!(
        "{}:{}:{}",
        model_id,
        hex_encode(request_hash),
        hex_encode(response_hash)
    )
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::{testing_env, AccountId};

    fn ctx(pred: AccountId) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(pred);
        b.attached_deposit(OPEN_DEPOSIT);
        b
    }

    fn keypair() -> (SigningKey, [u8; 32]) {
        let sk = SigningKey::from_bytes(&[7u8; 32]);
        let pk: [u8; 32] = sk.verifying_key().to_bytes();
        (sk, pk)
    }

    fn hashes() -> ([u8; 32], [u8; 32]) {
        ([1u8; 32], [2u8; 32])
    }

    fn finding(sk: &SigningKey, pk: [u8; 32]) -> SignedFinding {
        let (req, resp) = hashes();
        let model = "z-ai/glm-5.3-flash";
        let text = signed_text(model, &req, &resp);
        let sig = sk.sign(text.as_bytes()).to_bytes();
        SignedFinding {
            model_id: model.into(),
            request_hash: req,
            response_hash: resp,
            signature: sig.to_vec(),
            signer_pubkey: pk,
            gateway_report_hash: [3u8; 32],
            model_report_hash: [4u8; 32],
            nonce: [5u8; 32],
            tcb_status: TcbStatus::UpToDate,
            finding_hash: [6u8; 32],
            citation_hashes: vec![[7u8; 32]],
        }
    }

    fn contract() -> CustodyContract {
        testing_env!(ctx(accounts(0)).build());
        CustodyContract::new(accounts(0), accounts(1))
    }

    #[test]
    fn valid_signature_stores() {
        let (sk, pk) = keypair();
        let mut c = contract();
        c.add_signer(pk);
        testing_env!(ctx(accounts(1)).build());
        c.record_finding("case-1".into(), vec![[9u8; 32]], finding(&sk, pk), Verdict::Accept);
        assert_eq!(c.receipt_count(), 1);
        let r = c.get_receipt(0).unwrap();
        assert!(matches!(r.kind, ReceiptKind::Finding));
    }

    #[test]
    #[should_panic(expected = "ed25519_verify failed")]
    fn flipped_sig_rejected() {
        let (sk, pk) = keypair();
        let mut c = contract();
        c.add_signer(pk);
        let mut f = finding(&sk, pk);
        f.signature[0] ^= 0xff;
        testing_env!(ctx(accounts(1)).build());
        c.record_finding("case-1".into(), vec![], f, Verdict::Accept);
    }

    #[test]
    #[should_panic(expected = "replayed response")]
    fn replay_rejected() {
        let (sk, pk) = keypair();
        let mut c = contract();
        c.add_signer(pk);
        testing_env!(ctx(accounts(1)).build());
        let f = finding(&sk, pk);
        c.record_finding("case-1".into(), vec![[9u8; 32]], f.clone(), Verdict::Accept);
        c.record_finding("case-1".into(), vec![[9u8; 32]], f, Verdict::Accept);
    }

    #[test]
    fn open_denied_does_not_panic() {
        let mut c = contract();
        testing_env!(ctx(accounts(2)).build());
        let ok = c.request_open("case-1".into(), "E1".into(), "nope".into());
        assert!(!ok);
        assert_eq!(c.receipt_count(), 1);
        assert!(matches!(
            c.get_receipt(0).unwrap().kind,
            ReceiptKind::OpenDenied
        ));
    }

    #[test]
    fn grant_then_open() {
        let mut c = contract();
        c.grant("case-1".into(), accounts(2));
        testing_env!(ctx(accounts(2)).build());
        let ok = c.request_open("case-1".into(), "E1".into(), "review".into());
        assert!(ok);
        assert!(matches!(c.get_receipt(0).unwrap().kind, ReceiptKind::Open));
    }

    #[test]
    fn custody_check_pass_and_tamper() {
        let mut c = contract();
        testing_env!(ctx(accounts(1)).build());
        let commit = [11u8; 32];
        c.record_custody_check("case-1".into(), commit, 0, true);
        let mut flipped = commit;
        flipped[0] ^= 0xff;
        c.record_custody_check("case-1".into(), flipped, 0, false);
        assert_eq!(c.receipt_count(), 2);
        assert!(matches!(
            c.get_receipt(0).unwrap().policy_verdict,
            Some(Verdict::Accept)
        ));
        let r1 = c.get_receipt(1).unwrap();
        assert!(matches!(r1.kind, ReceiptKind::CustodyCheck));
        assert!(matches!(r1.policy_verdict, Some(Verdict::Block)));
        assert_ne!(r1.evidence_commitments[0], commit);
    }
}
