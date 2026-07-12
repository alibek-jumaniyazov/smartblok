// /bank — Bank hisoblar. The same treasury view as /kassa, scoped to BANK-type
// accounts (cards, period summary, journal, manual op, and cashbox CRUD are all
// filtered/created for the bank family). Shares the KassaView implementation.
import { KassaView } from './Kassa';

export default function Bank() {
  return <KassaView scope="bank" />;
}
