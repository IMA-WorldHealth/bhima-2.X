DELIMITER $$

/*

--------
OVERVIEW
--------

This file contains the logic for safeguarding the general_ledger from invalid
transaction by enforcing a series of checks, known as the Trial Balance.  The
end result is 0 or more errors returned to the client as well as a preview of
how the account balances will change once the data is transferred from the
posting_journal to the general_ledger.

Since much preprocessing is required, several temporary tables are used.  This
allows the data to enter SQL as quickly as possible and leverage INDEXes, JOINs,
and GROUP BYs as quickly as possible.

---------
SCENARIOS
---------

There are several reasons why a transaction might fail a trial balance check.
We will discuss a few of them below:

ADDING TO LOCKED FISCAL YEARS
-----------------------------
Once an accountant has approved of the end of year report, the previous fiscal
year is generally locked and balance accounts are carried forward while income
and expense accounts are zeroed out.  This operation ensures that the general
ledger will remain faithful to the last audit.

However, a user may potentially generate transactions for a previous fiscal
year.  These transactions may not be malicious in intent - some unexpected prior
invoices may need to be added after a year has been locked.  The Trial Balance
will block these invoices from being posted, requiring that the accountant
carefully review why these transactions.  If they are valid, the accountant may
unlock the fiscal year and post them.


LOCKED ACCOUNTS
---------------
An accountant may close down an account in the system for any reason - perhaps
to remove a duplication, perhaps to indicate that a client will no longer be
serviced by the hospital.  This operation can be achieved by locking the account
in the accounts management page.  If there are pending transactions, these will
be blocked from posting until a decision can be made about them.
*/




/*
CALL StageTrialBalanceTransaction()

DESCRIPTION
Copies the transaction into a staging table to be quickly operated on.
*/
CREATE PROCEDURE StageTrialBalanceTransaction(
  IN record_uuid BINARY(16)
)
BEGIN
  CREATE TEMPORARY TABLE IF NOT EXISTS stage_trial_balance_transaction (record_uuid BINARY(16));
  INSERT INTO stage_trial_balance_transaction SET stage_trial_balance_transaction.record_uuid = record_uuid;
END $$

/*
CALL TrialBalanceErrors()

DESCRIPTION
This stored procedure validates records that are used in the Trial Balance before they are posted
to the General Ledger.  The records are run through a series of SQL queries to validate their
correctness.  The follow assertions are made:
 1. The transaction dates are within the identified period
 2. Every line has some sort of description (best practice)
 3. All affected periods are unlocked.
 4. All affected accounts are unlocked.
 5. All transactions are balanced.
 6. All transactions have at least two lines (required for double-entry accounting)

Please be sure to stage all transactions for use via the StageTrialBalanceTransaction()
call.

SAMPLE OUTPUT
Running this query will return NULL if no errors have occurred.  If errors exist in the transaction,
the following table will be emitted.
+--------------------------------------+----------+------------------------------------------------+
| record_uuid                          | trans_id | code                                           |
+--------------------------------------+----------+------------------------------------------------+
| 666bfbbe-48d4-435e-997b-238a48760a1a | HEV39508 | POSTING_JOURNAL.ERRORS.UNBALANCED_TRANSACTIONS |
+--------------------------------------+----------+------------------------------------------------+

USAGE: CALL TrialBalanceErrors()
*/
CREATE PROCEDURE TrialBalanceErrors()
BEGIN
  DECLARE title_account_id INT UNSIGNED DEFAULT NULL;

  -- @const the account type for title accounts is 6.
  SET title_account_id = 6;

  DROP TEMPORARY TABLE IF EXISTS stage_trial_balance_errors;

  -- this will hold our error cases
  CREATE TEMPORARY TABLE stage_trial_balance_errors (
    record_uuid BINARY(16),
    trans_id TEXT,
    error_description TEXT,
    code TEXT
  );

  -- check if there are any title accounts in the mix
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), CONCAT(a.number,' - ', a.label) as error_description, 'POSTING_JOURNAL.ERRORS.HAS_TITLE_ACCOUNT_BALANCE' AS code
    FROM posting_journal AS pj
      JOIN stage_trial_balance_transaction AS temp ON pj.record_uuid = temp.record_uuid
      JOIN account a ON pj.account_id = a.id
    WHERE a.type_id = title_account_id GROUP BY pj.record_uuid;

  -- check if dates are in the correct period
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), CONCAT(pj.trans_id, ' : ', pj.trans_date) as error_description, 'POSTING_JOURNAL.ERRORS.DATE_IN_WRONG_PERIOD' AS code
    FROM posting_journal AS pj
      JOIN stage_trial_balance_transaction AS temp ON pj.record_uuid = temp.record_uuid
      JOIN period AS p ON pj.period_id = p.id
    WHERE DATE(pj.trans_date) NOT BETWEEN DATE(p.start_date) AND DATE(p.end_date)
    GROUP BY pj.record_uuid;

  -- check to make sure that the fiscal year is not closed
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), fiscal_year.label as error_description,'POSTING_JOURNAL.ERRORS.CLOSED_FISCAL_YEAR' AS code
    FROM posting_journal AS pj JOIN stage_trial_balance_transaction AS temp
      ON pj.record_uuid = temp.record_uuid
      JOIN fiscal_year ON pj.fiscal_year_id = fiscal_year.id
    WHERE fiscal_year.locked <> 0
    GROUP BY pj.record_uuid;

  -- check to make sure that all lines of a transaction have a description
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), pj.trans_id as error_description, 'POSTING_JOURNAL.ERRORS.MISSING_DESCRIPTION' AS code
    FROM posting_journal AS pj JOIN stage_trial_balance_transaction AS temp
      ON pj.record_uuid = temp.record_uuid
    WHERE pj.description IS NULL
    GROUP BY pj.record_uuid;

  -- check that all periods are unlocked
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), CONCAT(p.start_date, ' ', p.end_date) as error_description, 'POSTING_JOURNAL.ERRORS.LOCKED_PERIOD' AS code
    FROM posting_journal AS pj JOIN stage_trial_balance_transaction AS temp
      ON pj.record_uuid = temp.record_uuid
    JOIN period p ON pj.period_id = p.id
    WHERE p.locked = 1 GROUP BY pj.record_uuid;

  -- check that there are no transactions with accounts of locked creditor groups
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), cg.name as error_description, 'POSTING_JOURNAL.ERRORS.LOCKED_CREDITOR_GROUP_ACCOUNT' AS code
    FROM posting_journal AS pj JOIN stage_trial_balance_transaction AS temp
      ON pj.record_uuid = temp.record_uuid
    JOIN creditor_group cg ON pj.account_id = cg.account_id
    WHERE cg.locked = 1 GROUP BY pj.record_uuid;

  -- check that there are no transactions with accounts of locked debtor groups
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), dg.name as error_description, 'POSTING_JOURNAL.ERRORS.LOCKED_DEBTOR_GROUP_ACCOUNT' AS code
    FROM posting_journal AS pj JOIN stage_trial_balance_transaction AS temp
      ON pj.record_uuid = temp.record_uuid
    JOIN debtor_group dg ON pj.account_id = dg.account_id
    WHERE dg.locked = 1 GROUP BY pj.record_uuid;

  -- check that all accounts are unlocked
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), CONCAT(a.number,' - ', a.label) as error_description, 'POSTING_JOURNAL.ERRORS.LOCKED_ACCOUNT' AS code
    FROM posting_journal AS pj JOIN stage_trial_balance_transaction AS temp
      ON pj.record_uuid = temp.record_uuid
    JOIN account a ON pj.account_id = a.id
    WHERE a.locked = 1 GROUP BY pj.record_uuid;

  -- check that users are active (no deactivated users)
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), u.display_name as error_description, 'POSTING_JOURNAL.ERRORS.DEACTIVATED_USER' AS code
    FROM posting_journal AS pj JOIN stage_trial_balance_transaction AS temp
      ON pj.record_uuid = temp.record_uuid
    JOIN user u ON pj.user_id = u.id
    WHERE u.deactivated = 1 GROUP BY pj.record_uuid;

  -- check that all transactions are balanced
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), pj.trans_id as error_description, 'POSTING_JOURNAL.ERRORS.UNBALANCED_TRANSACTIONS' AS code
    FROM posting_journal AS pj JOIN stage_trial_balance_transaction AS temp
      ON pj.record_uuid = temp.record_uuid
    GROUP BY pj.record_uuid
    HAVING ROUND(SUM(pj.debit_equiv), 2) <> ROUND(SUM(pj.credit_equiv), 2);

  -- check that all transactions have two or more lines
  INSERT INTO stage_trial_balance_errors
    SELECT pj.record_uuid, MAX(pj.trans_id), pj.trans_id as error_description, 'POSTING_JOURNAL.ERRORS.SINGLE_LINE_TRANSACTION' AS code
    FROM posting_journal AS pj JOIN stage_trial_balance_transaction AS temp
      ON pj.record_uuid = temp.record_uuid
    GROUP BY pj.record_uuid
    HAVING COUNT(pj.record_uuid) < 2;

  SELECT DISTINCT BUID(record_uuid) AS record_uuid, trans_id, error_description, code FROM stage_trial_balance_errors ORDER BY code, trans_id;
END $$

/*
CALL TrialBalanceSummary()

DESCRIPTION
This stored procedure produces the traditional Trial Balance table showing the account balances for any affected accounts
prior to the balance (`balance_before`), the debits to the accounts (`debit_equiv`), the credits to the accounts
(`credit_equiv`), and the proposed balances at the end of the operation (`balance_final`).  It should be used before
posting to the General Ledger to ensure that all transactions are correctly processed.

To use this method, a Trial Balance must first be _staged_.  The application expects that the record_uuids of all
transactions are already placed in the stage_trial_balance_transaction table via a call to
StageTrialBalanceTransaction().

SAMPLE OUTPUT
Running this a table with the following type:
+------------+--------+----------------------+----------------+-------------+--------------+----------------+
| account_id | number | label                | balance_before | debit_equiv | credit_equiv | balance_final  |
+------------+--------+----------------------+----------------+-------------+--------------+----------------+
|       3880 | 411900 | Patients Payant Cash | -22554880.0000 |  12250.0000 |   29100.0000 | -22571730.0000 |
|       3734 | 570001 | Petite Caisse (FC)   |   3331350.0000 |  29100.0000 |       0.0000 |   3360450.0000 |
|       3704 | 700100 | Pharmacie d’usage    |  -2516075.0000 |  17250.0000 |       0.0000 |  -2498825.0000 |
|       3886 | 700102 | Medicaments          | -23284054.9000 |      0.0000 |   29000.0000 | -23313054.9000 |
|       3887 | 700201 | Fiches               |   -497600.0000 |      0.0000 |     500.0000 |   -498100.0000 |
+------------+--------+----------------------+----------------+-------------+--------------+----------------+


USAGE: CALL TrialBalanceSummary()
*/
--
DROP PROCEDURE IF EXISTS TrialBalanceSummary$$
CREATE PROCEDURE TrialBalanceSummary()
BEGIN
  -- this assumes lines have been staged using CALL StageTrialBalanceTransaction()

  -- fiscal year to limit period_total search
  DECLARE fiscalYearId MEDIUMINT;

  DROP TEMPORARY TABLE IF EXISTS staged_account;
  DROP TEMPORARY TABLE IF EXISTS before_totals;

  -- get the fiscal year of the oldest record to limit period_total search
  SET fiscalYearId = (
    SELECT MIN(fiscal_year_id)
    FROM posting_journal JOIN stage_trial_balance_transaction
      ON posting_journal.record_uuid = stage_trial_balance_transaction.record_uuid
  );

  -- gather the staged accounts
  CREATE TEMPORARY TABLE IF NOT EXISTS staged_accounts AS
    SELECT DISTINCT account_id FROM posting_journal JOIN stage_trial_balance_transaction
    ON posting_journal.record_uuid = stage_trial_balance_transaction.record_uuid;

  -- gather the beginning period_totals
  CREATE TEMPORARY TABLE before_totals AS
    SELECT u.account_id, IFNULL(SUM(totals.debit - totals.credit), 0) AS balance_before
    FROM staged_accounts as u
    LEFT JOIN (
      SELECT account_id, debit, credit FROM period_total
      WHERE period_total.fiscal_year_id = fiscalYearId
    ) totals ON u.account_id = totals.account_id
    GROUP BY u.account_id;

  SELECT account_id, account.number AS number, account.label AS label, account.type_id,
    balance_before, debit_equiv, credit_equiv,
    balance_before + debit_equiv - credit_equiv AS balance_final
  FROM (
    SELECT posting_journal.account_id, MAX(totals.balance_before) AS balance_before, SUM(debit_equiv) AS debit_equiv,
      SUM(credit_equiv) AS credit_equiv
    FROM posting_journal JOIN before_totals as totals
    ON posting_journal.account_id = totals.account_id
    WHERE posting_journal.record_uuid IN (
      SELECT record_uuid FROM stage_trial_balance_transaction
    ) GROUP BY posting_journal.account_id
  ) AS combined
  JOIN account ON account.id = combined.account_id
  ORDER BY account.number;
END $$

/*
PostToGeneralLedger()

This procedure uses the same staging code as the Trial Balance to stage and then post transactions
from the posting_journal table to the General Ledger table.

*/
CREATE PROCEDURE PostToGeneralLedger()
BEGIN

  DECLARE isInvoice, isCash, isVoucher INT;

  -- write into the posting journal
  INSERT INTO general_ledger (
    project_id, uuid, fiscal_year_id, period_id, trans_id, trans_id_reference_number, trans_date,
    record_uuid, description, account_id, debit, credit, debit_equiv,
    credit_equiv, currency_id, entity_uuid, reference_uuid, comment, transaction_type_id, user_id
  ) SELECT project_id, uuid, fiscal_year_id, period_id, trans_id, trans_id_reference_number, trans_date, posting_journal.record_uuid,
    description, account_id, debit, credit, debit_equiv, credit_equiv, currency_id,
    entity_uuid, reference_uuid, comment, transaction_type_id, user_id
  FROM posting_journal JOIN stage_trial_balance_transaction AS staged
    ON posting_journal.record_uuid = staged.record_uuid;

  -- write into period_total
  INSERT INTO period_total (
    account_id, credit, debit, fiscal_year_id, enterprise_id, period_id
  )
  SELECT account_id, SUM(credit_equiv) AS credit, SUM(debit_equiv) as debit,
    fiscal_year_id, project.enterprise_id, period_id
  FROM posting_journal JOIN stage_trial_balance_transaction JOIN project
    ON posting_journal.record_uuid = stage_trial_balance_transaction.record_uuid
    AND project_id = project.id
  GROUP BY fiscal_year_id, period_id, account_id
  ON DUPLICATE KEY UPDATE credit = credit + VALUES(credit), debit = debit + VALUES(debit);

  -- remove from posting journal
  DELETE FROM posting_journal WHERE record_uuid IN (SELECT record_uuid FROM stage_trial_balance_transaction);

  -- Let specify that this invoice or the cash payment is posted
  SELECT COUNT(uuid) INTO isInvoice FROM invoice WHERE invoice.uuid IN (SELECT record_uuid FROM stage_trial_balance_transaction);
  SELECT COUNT(uuid) INTO isCash FROM cash WHERE cash.uuid IN (SELECT record_uuid FROM stage_trial_balance_transaction);
  SELECT COUNT(uuid) INTO isVoucher FROM voucher WHERE voucher.uuid IN (SELECT record_uuid FROM stage_trial_balance_transaction);

  IF isInvoice > 0 THEN
    UPDATE invoice SET posted = 1 WHERE EXISTS (SELECT 1 FROM stage_trial_balance_transaction t WHERE t.record_uuid = invoice.uuid);
  END IF;

  IF isCash > 0 THEN
    UPDATE cash SET posted = 1 WHERE EXISTS (SELECT 1 FROM stage_trial_balance_transaction t WHERE t.record_uuid = cash.uuid);
  END IF;

  IF isVoucher > 0 THEN
    UPDATE voucher SET posted = 1 WHERE EXISTS (SELECT 1 FROM stage_trial_balance_transaction t WHERE t.record_uuid = voucher.uuid);
  END IF;

  /* DROP TEMPORARY TABLE stage_trial_balance_transaction; */
END $$

DELIMITER ;
