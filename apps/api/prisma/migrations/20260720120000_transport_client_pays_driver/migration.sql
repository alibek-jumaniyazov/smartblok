-- Transport settlement route: the client hands the driver his cut out of the money he
-- owes for the goods, and the remainder to the dealer. Economically identical to
-- DEALER_ABSORBED (transport sits INSIDE the goods total); only the cash route differs,
-- so it is a new mode rather than a new money column.
--
-- DEALER_CHARGED (transport billed ON TOP) is deliberately NOT dropped: existing rows
-- must keep rendering. It is rejected at the service layer for new/edited orders.
ALTER TYPE "TransportMode" ADD VALUE IF NOT EXISTS 'CLIENT_PAYS_DRIVER';
