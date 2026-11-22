# jan-api

## JAN code structure

Notes on how a JAN code is built. `isValidJan` validates a code and `computeJanCheckDigit` computes its check digit; both are exported from this package.

## General

- JAN stands for Japanese Article Number
- A JAN code is a 13-digit or 8-digit number
- Only digits are allowed
- 13 digits is the standard type (GTIN-13)
- 8 digits is the short type (GTIN-8)

## GTIN-13 (standard type)

- The most widely used JAN code in Japan

### GTIN-13 layout

- GS1 company prefix, then item code, then check digit
- The GS1 company prefix is the first 7, 9 or 10 digits, and 7 or 9 digits is the common case
- Internally the prefix splits into a country code and a company code

### Country code

- Identifies the country
- The first 2 digits of the GS1 company prefix
- For Japan it is either 45 or 49
- For 49, the company code is 5 digits and the item code is 5 digits
- For 45 where the company code starts with 0 to 5, the company code is 5 digits and the item code is 5 digits
- For 45 where the company code starts with 6 to 9, the company code is 7 digits and the item code is 3 digits
- For 45 where the company code starts with 95, the company code is 8 digits and the item code is 2 digits (not finalized)

### Company code

- Identifies the company
- 5 or 7 digits

### Item code

- Identifies the product
- 5 or 3 digits

### Check digit

- A digit computed with a fixed formula for error detection

## Check digit calculation

Positions are counted from the right, with the check digit itself as position 1. This matches `computeJanCheckDigit`, which takes the digits without the check digit.

1. Sum all the even-position digits, then multiply the sum by 3
2. Sum all the odd-position digits, excluding the check digit
3. Add the two results and take the last digit
4. 10 minus that last digit is the check digit; if the last digit is 0, the check digit is 0

## GTIN-8 (short type)

- Used only within Japan

### GTIN-8 layout

- Country code: 2 digits, 49 or 45
- Company code: 4 digits
- Item code: 1 digit

## GTIN-14 (code for grouped packaging)

- A product code for shipping boxes
- 14 digits
- Contains the 12 digits of a GTIN-13 other than its check digit
- The first digit is an indicator that expresses the packaging state
- Companies may assign it freely
- The check digit is recalculated
