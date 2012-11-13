// ERPNext - web based ERP (http://erpnext.com)
// Copyright (C) 2012 Web Notes Technologies Pvt Ltd
// 
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// 
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// 
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

wn.require("app/js/transaction.js");
wn.provide("erpnext");

erpnext.TaxesAndTotals = erpnext.Transaction.extend({
	print_ref_rate: function(doc, cdt, cdn) {
		var item = wn.model.get(cdt, cdn)[0];
		
		item.discount = flt(item.discount, this.frm.precision.item.discount);
		
		if(item.discount == 100) {
			item.print_rate = 0;
		} else {
			item.print_rate = flt(item.print_ref_rate * (1 - (item.discount / 100.0)),
				this.frm.precision.item.print_rate);
		}
		
		this.calculate_taxes_and_totals();
	},
	
	discount: function(doc, cdt, cdn) {
		this.print_ref_rate(doc, cdt, cdn);
	},
	
	print_rate: function(doc, cdt, cdn) {
		var item = wn.model.get(cdt, cdn)[0];
		
		if(item.print_ref_rate) {
			// calculate discount
			item.discount = flt(100 * (1 - (item.print_rate / item.print_ref_rate)),
				this.frm.precision.item.discount);
		} else if (item.discount == 100) {
			// calculate print_ref_rate
			item.print_ref_rate = 0
		} else {
			// calculate print_ref_rate
			item.print_ref_rate = flt(item.print_rate / (1 - (item.discount / 100.0)),
				this.frm.precision.item.print_ref_rate);
		}
		
		this.calculate_taxes_and_totals()
	},
	
	qty: function(doc, cdt, cdn) {
		this.calculate_taxes_and_totals();
	},
	
	exchange_rate: function() {
		this.calculate_taxes_and_totals();
	},
	
	calculate_taxes_and_totals: function() {
		this.frm.doc.exchange_rate = flt(this.frm.doc.exchange_rate,
			this.frm.precision.main.exchange_rate);
		
		this.frm.item_doclist = wn.model.get_doclist(this.frm.doc.doctype,
			this.frm.doc.name, {parentfield: this.get_item_table_field()});
		this.frm.tax_doclist = wn.model.get_doclist(this.frm.doc.doctype,
			this.frm.doc.name, {parentfield: "taxes_and_charges"});
		
		this.calculate_item_values();
		
		var taxes_and_charges = wn.meta.get_docfield(this.frm.doc.doctype,
			"taxes_and_charges");
		
		this.initialize_taxes()
		
		// in case of inclusive rate
		if(taxes_and_charges && 
			wn.meta.get_docfield(taxes_and_charges.options, "included_in_print_rate")) {
				this.determine_exclusive_rate();
		}
		
		this.calculate_net_total();
		this.calculate_taxes();
		this.calculate_totals();
		// this.set_amount_in_words();
		
		// refresh main form fields, item table and taxes and charges
		refresh_field($.map(this.frm.precision.main, function(val, key) { return key; }));
		refresh_field(this.get_item_table_field());
		if(taxes_and_charges) refresh_field("taxes_and_charges");
	},
	
	calculate_item_values: function() {
		var me = this;
		
		var _set_base = function(item, print_field, base_field) {
			item[base_field] = flt(flt(item[print_field],
				me.frm.precision.item[print_field]) * me.frm.doc.exchange_rate,
				me.frm.precision.item[base_field]);
		};
		
		$.each(this.frm.item_doclist, function(i, item) {
			wn.model.round_doc(item, me.frm.precision.item);
			
			item.print_amount = flt(item.print_rate * item.qty,
				me.frm.precision.item.print_amount);
			
			_set_base(item, "print_ref_rate", "ref_rate");
			_set_base(item, "print_rate", "rate");
			_set_base(item, "print_amount", "amount");
		});
	},
	
	initialize_taxes: function() {
		var me = this;
		
		$.each(this.frm.tax_doclist, function(i, tax) {
			// initialize totals to 0
			tax.tax_amount = tax.total = tax.total_print = 0;
			tax.grand_total_for_current_item = tax.tax_amount_for_current_item = 0;
			
			// for actual type, user can mention actual tax amount in tax.tax_amount_print
			if(tax.charge_type != "Actual" || tax.rate) {
				tax.tax_amount_print = 0;
			}
			
			me.validate_on_previous_row(tax)
			me.validate_included_tax(tax)
			
			// round relevant values
			wn.model.round_doc(tax, me.frm.precision.tax);
		});
	},
	
	calculate_net_total: function() {
		var me = this;
		
		this.frm.doc.net_total = 0;
		this.frm.doc.net_total_print = 0;
		
		$.each(this.frm.item_doclist, function(i, item) {
			me.frm.doc.net_total += item.amount;
			me.frm.doc.net_total_print += item.print_amount;
		});
		
		this.frm.doc.net_total = flt(this.frm.doc.net_total,
			this.frm.precision.main.net_total);
		this.frm.doc.net_total_print = flt(this.frm.doc.net_total_print,
			this.frm.precision.main.net_total_print);
	},
	
	calculate_taxes: function() {
		var me = this;
		
		$.each(this.frm.item_doclist, function(i, item) {
			item_tax_map = me._load_item_tax_rate(item.item_tax_rate);
			item.valuation_tax_amount = 0;
			
			$.each(me.frm.tax_doclist, function(i, tax) {
				// tax_amount represents the amount of tax for the current step
				var current_tax_amount = me.get_current_tax_amount(item, tax,
					item_tax_map);
				
				if(me.set_valuation_tax_amount) {
					me.set_valuation_tax_amount(item, tax, current_tax_amount);
				}
				
				// case when net total is 0 but there is an actual type charge
				// in this case add the actual amount to tax.tax_amount
				// and tax.grand_total_for_current_item for the first such iteration
				if(!(current_tax_amount || me.frm.doc.net_total || tax.tax_amount) && 
					tax.charge_type == "Actual") {
						var zero_net_total_adjustment = flt((tax.tax_amount_print *
							me.frm.doc.exchange_rate) || tax.rate,
							me.frm.precision.tax.tax_amount)
						current_tax_amount += zero_net_total_adjustment;
					}
				
				// store tax_amount for current item as it will be used for
				// charge type = 'On Previous Row Amount'
				tax.tax_amount_for_current_item = current_tax_amount;
				
				// accumulate tax amount into tax.tax_amount
				tax.tax_amount += tax.tax_amount_for_current_item;
				
				// accumulate tax_amount_print only if tax is not included
				// and if tax amount of actual type is entered in 'rate' field
				if(!cint(tax.included_in_print_rate) && (tax.charge_type != "Actual" || 
					tax.rate)) {
						tax.tax_amount_print += flt(
							(tax.tax_amount_for_current_item / me.frm.doc.exchange_rate),
							me.frm.precision.tax.tax_amount_print);
					}
				
				if(tax.category == "Valuation") {
					// if just for valuation, do not add the tax amount in total
					// hence, setting it as 0 for further steps
					current_tax_amount = 0;
				}
				
				// Calculate tax.total viz. grand total till that step
				// note: grand_total_for_current_item contains the contribution of 
				// item's amount, previously applied tax and the current tax on that item
				if(i == 0) {
					tax.grand_total_for_current_item = flt(item.amount +
						current_tax_amount, me.frm.precision.tax.total);
					
					// if inclusive pricing, current_tax_amount should not be considered
					if(cint(tax.included_in_print_rate)) {
						current_tax_amount = 0;
					}
					
					tax.grand_total_print_for_current_item = flt(item.print_amount +
						(current_tax_amount / me.frm.doc.exchange_rate),
						me.frm.precision.tax.total_print);
					
				} else {
					tax.grand_total_for_current_item = 
						flt(self.tax_doclist[i-1].grand_total_for_current_item +
							current_tax_amount, me.frm.precision.tax.total);
					
					// if inclusive pricing, current_tax_amount should not be considered
					if(cint(tax.included_in_print_rate)) {
						current_tax_amount = 0;
					}
					
					tax.grand_total_print_for_current_item = 
						flt(self.tax_doclist[i-1].grand_total_print_for_current_item +
							(current_tax_amount / me.frm.doc.exchange_rate),
							me.frm.precision.tax.total_print);
					
				}
				
				// in tax.total, accumulate grand total of each item
				tax.total += tax.grand_total_for_current_item;
				tax.total_print += tax.grand_total_print_for_current_item;
				
				// TODO store tax_breakup for each item
				
			});
		});
	},
	
	get_current_tax_amount: function(item, tax, item_tax_map) {
		var tax_rate = this._get_tax_rate(tax, item_tax_map);
		
		if(tax.charge_type == "Actual") {
			// distribute the tax amount proportionally to each item row
			var actual = flt(tax.rate || 
				(tax.tax_amount_print * this.frm.doc.exchange_rate),
				this.frm.precision.tax.tax_amount);
			var current_tax_amount = (this.frm.doc.net_total
				? ((item.amount / this.frm.doc.net_total) * actual) : 0);
			
		} else if(tax.charge_type == "On Net Total") {
			var current_tax_amount = (tax_rate / 100.0) * item.amount;
			
		} else if(tax.charge_type == "On Previous Row Amount") {
			var current_tax_amount = (tax_rate / 100.0) * 
				this.frm.tax_doclist[cint(tax.row_id) - 1].tax_amount_for_current_item;
			
		} else if(tax.charge_type == "On Previous Row Total") {
			var current_tax_amount = (tax_rate / 100.0) * 
				this.frm.tax_doclist[cint(tax.row_id) - 1].grand_total_for_current_item;
		}
		
		return flt(current_tax_amount, this.frm.precision.tax.tax_amount);
	},
	
	calculate_totals: function() {
		if(this.frm.tax_doclist.length > 0) {
			var last_tax = this.frm.tax_doclist[this.frm.tax_doclist.length - 1];
			this.frm.doc.grand_total = flt(last_tax.total,
				this.frm.precision.main.grand_total);
			this.frm.doc.grand_total_print = flt(last_tax.total_print,
				this.frm.precision.main.grand_total_print);
			
		} else {
			this.frm.doc.grand_total = flt(this.frm.doc.net_total,
				this.frm.precision.main.grand_total);
			this.frm.doc.grand_total_print = flt(this.frm.doc.net_total_print,
				this.frm.precision.main.grand_total_print);
		}
		
		this.frm.doc.taxes_and_charges_total = 
			flt(this.frm.doc.grand_total - this.frm.doc.net_total,
				this.frm.precision.main.taxes_and_charges_total)
		this.frm.doc.taxes_and_charges_total_print = 
			flt(this.frm.doc.grand_total_print - this.frm.doc.net_total_print,
				this.frm.precision.main.taxes_and_charges_total_print)
		
		this.frm.doc.rounded_total = Math.round(this.frm.doc.grand_total)
		this.frm.doc.rounded_total_print = Math.round(this.frm.doc.grand_total_print)
	},
	
	// set_amount_in_words: function() {
	// 	var base_currency = wn.boot.company[this.frm.doc.company].default_currency;
	// 	
	// 	this.frm.doc.grand_total_in_words = 
	// 	this.frm.doc.rounded_total_in_words = 
	// 	
	// 	this.frm.doc.grand_total_in_words_print = 
	// 	this.frm.doc.rounded_total_in_words_print = 
	// 	
	// },
	// 
	validate_on_previous_row: function(tax) {
		// validate if a valid row id is mentioned in case of
		// On Previous Row Amount and On Previous Row Total
		if(in_list(["On Previous Row Amount", "On Previous Row Total"], tax.charge_type) 
				&& (!tax.row_id || tax.row_id >= tax.idx)) {
			var msg = repl(wn._("Row") + " # %(idx)s [%(taxes_doctype)s]: " +
				wn._("Please specify a valid") + " %(row_id_label)s", {
					idx: tax.idx,
					taxes_doctype: tax.doctype,
					row_id_label: wn.meta.get_docfield(tax.doctype, "row_id").label
				});
			msgprint(msg);
			throw msg;
		}
	},
	
	validate_included_tax: function(tax) {
		var _on_previous_row_error = function(tax, row_range) {
			var msg = repl(wn._("Row") + " # %(idx)s [%(taxes_doctype)s]: " +
				wn._("If") + " '%(inclusive_label)s' " + wn._("is checked for") +
				" '%(charge_type_label)s' = '%(charge_type)s', " + wn._("then") + " " +
				wn._("Row") + " # %(row_range)s " + wn._("should also have") +
				" '%(inclusive_label)s' = " + wn._("checked"), {
					idx: tax.idx,
					taxes_doctype: tax.doctype,
					inclusive_label: wn.meta.get_docfield(tax.doctype,
						"included_in_print_rate").label,
					charge_type_label: wn.meta.get_docfield(tax.doctype,
						"charge_type").label,
					charge_type: tax.charge_type,
					row_range: row_range
				});
			msgprint(msg);
			throw msg;
		};
		
		if(cint(tax.included_in_print_rate)) {
			if(tax.charge_type == "Actual") {
				var msg = repl(wn._("Row") + " # %(idx)s [%(taxes_doctype)s]: " +
					"'%(charge_type_label)s' = '%(charge_type)s' " +
					wn._("cannot be included in item's rate"), {
						idx: tax.idx,
						taxes_doctype: tax.doctype,
						charge_type_label: wn.meta.get_docfield(tax.doctype,
							"charge_type").label,
						charge_type: tax.charge_type,
				});
				msgprint(msg);
				throw msg;
				
			} else if(tax.charge_type == "On Previous Row Amount" &&
				!cint(this.frm.tax_doclist[tax.row_id - 1].included_in_print_rate)) {
					// for an inclusive tax of type "On Previous Row Amount",
					// dependent row should also be inclusive
					_on_previous_row_error(tax, tax.row_id);
					
			} else if(tax.charge_type == "On Previous Row Total" &&
				!wn.utils.all($(this.frm.tax_doclist.slice(0, tax.idx - 1)).map(
				function(i, tax) { return cint(tax.included_in_print_rate); }))) {
					// for an inclusive tax of type "On Previous Row Total", 
					// all rows above it should also be inclusive
					_on_previous_row_error(tax, "1 - " + (tax.idx - 1));
					
			}
		}
	},
	
	determine_exclusive_rate: function() {
		var me = this;
		
		if(!wn.utils.any($(this.frm.tax_doclist).map(
			function(i, tax) { return cint(tax.included_in_print_rate); }))) {
				// if no tax is marked as included in print rate,
				// no need to proceed further
				return;
		}
		
		$.each(this.frm.item_doclist, function(i, item) {
			var item_tax_map = me._load_item_tax_rate(item.item_tax_rate);
			
			var cumulated_tax_fraction = 0;
			
			$.each(me.frm.tax_doclist, function(i, tax) {
				if(cint(tax.included_in_print_rate)) {
					tax.tax_fraction_for_current_item =
						me.get_current_tax_fraction(tax, item_tax_map);
				} else {
					tax.tax_fraction_for_current_item = 0;
				}
				
				if(i == 0) {
					tax.grand_total_fraction_for_current_item = 1 +
						tax.tax_fraction_for_current_item;
				} else {
					tax.grand_total_fraction_for_current_item =
						me.frm.tax_doclist[i-1].grand_total_fraction_for_current_item
						+ tax.tax_fraction_for_current_item;
				}
				
				cumulated_tax_fraction += tax.tax_fraction_for_current_item;
			});
			
			if(cumulated_tax_fraction) {
				item.rate = flt((item.print_rate * me.frm.doc.exchange_rate) / 
					(1 + cumulated_tax_fraction), me.frm.precision.item.rate);
				
				item.amount = flt(item.rate * item.qty, me.frm.precision.item.amount);
				
				item.ref_rate = flt(item.rate / (1 - (item.discount / 100.0)),
					me.frm.precision.item.ref_rate);
			}
		});
	},
	
	get_current_tax_fraction: function(tax, item_tax_map) {
		// Get tax fraction for calculating tax exclusive amount
		// from tax inclusive amount
		var current_tax_fraction = 0;
		
		if(cint(tax.included_in_print_rate)) {
			var tax_rate = this._get_tax_rate(tax, item_tax_map);
			
			if(tax.charge_type == "On Net Total") {
				current_tax_fraction = tax_rate / 100.0;
				
			} else if(tax.charge_type == "On Previous Row Amount") {
				current_tax_fraction = (tax_rate / 100.0) * 
					this.frm.tax_doclist[cint(tax.row_id) - 1]
						.tax_fraction_for_current_item;
				
			} else if(tax.charge_type == "On Previous Row Total") {
				current_tax_fraction = (tax_rate / 100.0) * 
					this.frm.tax_doclist[cint(tax.row_id) - 1]
						.grand_total_fraction_for_current_item;
				
			}
		}
		
		return current_tax_fraction;
	},
	
	_load_item_tax_rate: function(item_tax_rate) {
		if(!item_tax_rate) return {};
		
		return JSON.parse(item_tax_rate);
	},
	
	_get_tax_rate: function(tax, item_tax_rate) {
		if(item_tax_map.hasOwnProperty(tax.account_head)) {
			return flt(item_tax_map[tax.account_head], this.frm.precision.tax.rate);
		} else {
			return tax.rate;
		}
	},
	
});