# Target

This page is the target. It is not what the process does today. Today, listed routes are answered here and unlisted traffic is forwarded. An endpoint keeps today's rules until that endpoint has moved.

## Customer endpoints

Every customer API endpoint will be answered by this process. Endpoints move one at a time. A customer endpoint does not stay on the upstream as the lasting place that answers it.

Staff and operator tools are not customer endpoints. This repository does not name them.

## Two instances

Two instances of this process run at the same time. The public edge sends each customer to one of them. If one instance restarts, the other keeps answering.

## One tenth of a second

A customer call finishes within 100 ms. The call reads and writes only the local databases on the machine where this process runs. It does not wait on the upstream for that answer.

## Two local databases

Each instance has both of these. They are not the same database.

The read copy is a full copy of the upstream database. Display comes from it, for example a transaction list. The newest row may be missing. That is the display. It is not money that failed to arrive.

The write log only accepts commands. It does nothing else. A sync carries those rows to the upstream. The upstream applies each command once and stores the result in the upstream database. The read copy is then refreshed from the upstream. The customer is told about the result by a push or a webhook.

Money moves only when the upstream applies the command. The same command is not applied twice. Without the upstream database, a payout does not run.

## When the upstream is down

What one endpoint does when only the local databases are reachable is decided by that endpoint. There is no single rule for every endpoint.

Reads can still come from the read copy. New commands wait in the write log until the upstream accepts them. A restart of the upstream does not have to look like a failed call to the customer. A payout that leaves a few minutes later is not the same thing as this process being down.
