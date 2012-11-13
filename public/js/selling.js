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

wn.require("app/js/taxes_and_totals.js")
wn.provide("erpnext");

erpnext.Selling = erpnext.TaxesAndTotals.extend({
	refresh: function(doc, cdt, cdn) {
		this._super();
		this.set_price_list_details();
		this.set_dynamic_labels();
		this.set_sales_bom_help();
	},
	
	on_submit: function() {
		this.notify(this.frm.doc, {type: this.frm.doc.doctype, doctype: this.frm.doc.doctype});
	},
	
	toggle_fields: function() {
		var customer_fields = ['customer_address', 'contact_person', 'customer_name',
		 	'address_display', 'contact_display', 'customer_group', 'territory'];
		this.frm.toggle_display(customer_fields, this.frm.doc.customer);
		
		display_contact_section = (this.frm.doc.customer || this.frm.doc.lead) ? true : false;
		this.frm.toggle_display("contact_section", display_contact_section);
	},
	
	customer: function() {
		var me = this;
		var old_price_list = this.frm.doc.price_list_name;
		wn.call({
			doc: me.frm.doc,
			method: "get_customer_details",
			args: {"customer": me.frm.doc.customer},
			callback: function(r, rt) {
				me.frm.refresh();
				if (old_price_list != me.frm.doc.price_list_name) 
					me.set_price_list_details();
			}
		});
	},
	
	customer_address: function() {
		if (this.frm.doc.customer_address) {
			args = {"name": this.frm.doc.customer_address};
			this.get_address(args);
		}
	},
	
	shipping_address_name: function() {
		if (this.frm.doc.shipping_address_name) {
			args = {
				"name": this.frm.doc.shipping_address_name,
				"is_shipping_address": 1
			};
			this.get_address(args);
		}
	},
	
	contact_person: function() {
		if (this.frm.doc.contact_person)
			this.customer_address();
	},
	
	on_new_master: function(doctype, docname) {
		locals[doctype][docname].customer = 
		 	locals[this.frm.doc.doctype][this.frm.doc.name].customer;
		locals[doctype][docname].customer_name = 
		 	locals[this.frm.doc.doctype][this.frm.doc.name].customer_name;
	},
	
	project_name: function() {
		if (this.frm.doc.project_name) {
			wn.call({
				doc: me.frm.doc,
				method: "get_project_details",
				callback: function(r, rt) {
					me.frm.refresh();
				}
			});
		}
	},
	
	set_price_list_details: function() {
		var me = this;
		
		if (this.frm.doc.price_list_name && this.frm.doc.currency) {
			wn.call({
				doc: me.frm.doc,
				method: "set_price_list_details",
				callback: function(r, rt) {
					// toggle display relevant fields
					unhide_field(["price_list_currency", "plc_exchange_rate", "exchange_rate"]);
					if (r.message.length == 1 && 
							me.frm.doc.price_list_currency == me.frm.doc.currency) {
						hide_field(["price_list_currency", "plc_exchange_rate"]);
					}
					
					if (me.frm.doc.plc_exchange_rate == 1) hide_field("plc_exchange_rate");
					if (me.frm.doc.exchange_rate == 1) hide_field("exchange_rate");
					
					me.frm.toggle_display(['grand_total_print', 'rounded_total_print',
						'rounded_total_in_words_print'], me.frm.doc.exchange_rate != 1)
					
					// refresh relevant fields, 
					// did not called full form refresh because of infinte loop
					refresh_field(["currency", "exchange_rate", 
						"price_list_currency", "plc_exchange_rate", me.item_table_field])
				}
			});
		}
	},
	
	price_list_name: function() {
		this.set_price_list_details();
	},
	
	currency: function() {
		this.set_price_list_details();
	},
	
	price_list_currency: function() {
		this.set_price_list_details();
	},
	
	exchange_rate: function() {
		this.set_price_list_details();
	},
	
	plc_exchange_rate: function() {
		this.set_price_list_details();
	},
	
	company: function() {
		default_currency = wn.boot.company[this.frm.doc.company].default_currency;
		set_multiple(me.frm.doc.doctype, me.frm.doc.name, {
			"currency": default_currency,
			"exchange_rate": 1,
		});
		this.set_price_list_details();
	},
	
	warehouse: function(doc, cdt , cdn) {
		var me = this;
		var item = locals[cdt][cdn];
		if (item.warehouse) {
			wn.call({
				doc: me.frm.doc,
				method: "stock.utils.get_actual_qty"
				args: {
					"item_code": item.item_code,
					"warehouse": item.warehouse,
					"posting_date": me.frm.doc.posting_date,
					"posting_time": me.frm.doc.posting_time || ""
				},
				callback: function(r, rt) {
					$.extend(locals[cdt][cdn], r.message);
					refresh_field(me.item_table_field);
				}
			});
		}
	},
	
	get_charges: function() {
		var me = this;
		wn.call({
			doc: me.frm.doc,
			method: "append_taxes",
			callback: function(r, rt) {
				// to-do
				// recalculate taxes
			},
			btn: me.frm.fields_dict.get_charges.input
		})
	},
	
	sales_partner: function() {
		if(this.frm.doc.sales_partner) {
			get_server_fields('get_commission', "", "", this.frm.doc, 
				this.frm.doc.doctype, this.frm.doc.name, 1);
		}
	},
	
	commission_rate: function() {
		if(doc.commission_rate > 100) {
			msgprint("Commision rate cannot be greater than 100.");
		} else {
			this.frm.doc.total_commission = 
				flt(this.frm.doc.net_total, this.frm.precision.main.net_total) * 
				flt(this.frm.doc.commission_rate, this.frm.precision.main.commission_rate) / 100;
			refresh_field('total_commission');
		}
	},
	
	allocated_percentage: function(doc, cdt, cdn) {
		var d = locals[cdt][cdn];
		if (d.allocated_percentage) {
			d.allocated_amount = flt(this.frm.doc.net_total, this.frm.precision.net_total) * 
				flt(d.allocated_percentage) / 100;
			refresh_field('allocated_amount', d.name, "sales_team");
		}
	},
	
	set_dynamic_labels: function() {
		var me = this;
		var base_currency = wn.boot.company[this.frm.doc.company].default_currency;
		
		var _set_labels = function(fields, currency, dt) {
			for (f in fields) {
				if (dt == me.frm.doc.doctype) {
					me.frm.fields_dict[f].label_span.innerHTML 
						= me.frm.fields_dict[f] + ' (' + currency + ')';
				} else {
					$('[data-grid-fieldname="' + dt + '-' + f + '"]').html(fields[f] 
						+ ' (' + currency + ')');
				}
			}
		};
		
		var _map = function(field_currency_map) {
			for (doc_type in field_currency_map) {
				for (currency_type in field_currency_map[doc_type]) {
					var fields = field_currency_map[doc_type][currency_type];
					var currency = currency_type == "base_currency" ? 
						base_currency : me.frm.doc.currency;
					var dt = (doc_type == "parent_dt" ? me.frm.doc.doctype : 
						(doc_type == "item_dt" ? me.frm.doc.doc_type + " Item" : doc_type));
						
					_set_labels(fields, currency, dt);
				}
			}
		};
		
		// set fields label as per currency
		var field_currency_map = {
			"parent_dt": {
				"base_currency": {
					"net_total": "Net Total", 
					"taxes_and_charges_total": "Taxes and Charges Total", 
					"grand_total":	"Grand Total", 
					"rounded_total": "Rounded Total", 
					"rounded_total_in_words": "In Words"
				},
				"print_currency": {
					"grand_total_print": "Grand Total", 
					"rounded_total_print":	"Rounded Total", 
					"rounded_total_in_words_print":	"In Words"
				}
			},
			"item_dt": {
				"base_currency": {
					"rate": "Basic Rate", 
					"ref_rate": "Price List Rate", 
					"amount": "Amount"
				},
				"print_currency": {
					"print_rate": "Basic Rate", 
					"print_ref_rate": "Price List Rate", 
					"print_amount": "Amount"
				}
			},
			"Taxes and Charges": {
				"base_currency": {
					"tax_amount": "Amount", 
					"total": "Total"
				}
			}
		}
		
		_map(field_currency_map);
		
		// set label as per currency for extra fields in sales invoice
		if (this.frm.doc.doctype == 'Sales Invoice') {
			si_field_currency_map = {
				"parent_dt": {
					"base_currency": {
						'total_advance': 'Total Advance', 
						'outstanding_amount': 'Outstanding Amount', 
						'paid_amount': 'Paid Amount', 
						'write_off_amount': 'Write Off Amount'
					}
				},
				"Sales Invoice Advance": {
					"base_currency": {
						'advance_amount': 'Advance Amount', 
						'allocated_amount': 'Allocated Amount'
					}
				}
			}
			_map(si_field_currency_map);
		}
		
		// set labels for exchnage rate fields
		this.frm.fields_dict['exchange_rate'].label_span.innerHTML = 
			"Exchange Rate (" + this.frm.doc.currency +' -> '+ base_currency + ')';
		this.frm.fields_dict['plc_exchange_rate'].label_span.innerHTML = 
			'Price List Currency Exchange Rate (' + this.frm.doc.price_list_currency + 
			' -> '+ base_currency + ')';
			
		// hide base currency columns in item table if print currency is same as base currency
		var hide = (this.frm.doc.currency == base_currency) ? false : true;
		for (f in field_currency_map["item_dt"]["base_currency"]) {
			this.frm.fields_dict[this.item_table_field].grid.set_column_disp(f, hide);
		}
	},
	
	set_sales_bom_help: function() {
		if(!this.frm.fields_dict.packing_list) return;
		
		var has_packing_item = getchildren('Delivery Note Packing Item', doc.name,
		 		'delivery_note_packing_items').length;
		$(this.frm.fields_dict.packing_list.row.wrapper).toggle(has_packing_item ? true: false);
		
		if (inList(['Delivery Note', 'Sales Invoice'], doc.doctype)) {
			var help_msg = "";
			if (has_packing_item) {
				help_msg = "<div class='alert'> \
					For 'Sales BOM' items, warehouse, serial no and batch no \
					will be considered from the 'Packing List' table. \
					If warehouse and batch no are same for all packing items for any \
					'Sales BOM' item, those values can be entered in the main item table, \
					values will be copied to 'Packing List' table. </div>";
			}
			wn.meta.get_docfield(doc.doctype, 'sales_bom_help', doc.name).options = help_msg;
			refresh_field('sales_bom_help');
		}
	},
	
	setup_get_query: function() {
		this._super();
		var me = this;
		
		// item code
		this.frm.fields_dict[this.item_table_field].grid.get_field("item_code")
				.get_query = function() {
			if(inList(['Maintenance', 'Service'], me.frm.doc.order_type)) {
				var query = 'SELECT tabItem.name,tabItem.item_name,tabItem.description \
					FROM tabItem WHERE tabItem.is_service_item="Yes" \
					AND tabItem.docstatus != 2 \
					AND (ifnull(`tabItem`.`end_of_life`,"") = "" \
						OR `tabItem`.`end_of_life` > NOW() \
						OR `tabItem`.`end_of_life`="0000-00-00") \
					AND tabItem.%(key)s LIKE "%s" LIMIT 50';
			} else {
				var query = 'SELECT tabItem.name,tabItem.item_name,tabItem.description \
					FROM tabItem WHERE tabItem.is_sales_item="Yes" \
					AND tabItem.docstatus != 2 \
					AND (ifnull(`tabItem`.`end_of_life`,"") = "" \
						OR `tabItem`.`end_of_life` > NOW() \
						OR `tabItem`.`end_of_life`="0000-00-00") \
					AND tabItem.%(key)s LIKE "%s" LIMIT 50';
			}
			return query;
		}
		
		// customer address
		this.frm.fields_dict['customer_address'].get_query = function() {
			return "SELECT name, address_line1, city FROM tabAddress \
				WHERE customer = '" + me.frm.doc.customer + "' AND docstatus < 2 \
				AND name LIKE \"%s\" ORDER BY name ASC LIMIT 50";
		}

		// contact person
		this.frm.fields_dict['contact_person'].get_query = function() {
			return "SELECT name, CONCAT(first_name, ' ', ifnull(last_name, '')) AS FullName, \
			 	department, designation FROM tabContact \
				WHERE customer = '" + doc.customer +"' AND docstatus < 2 \
				AND name LIKE \"%s\" ORDER BY name ASC LIMIT 50";
		}
		
		// project name
		if (this.frm.fields_dict.project_name) {
			this.frm.fields_dict.project_name.get_query = function() {
				var condition = '';
				if (doc.customer) 
					condition = ' AND (ifnull(customer, "") = "" or customer = "' +  
						this.frm.doc.customer + '")';
				
				return repl('SELECT name FROM `tabProject` WHERE status not in \
					("Completed", "Cancelled") AND name LIKE \"%s\" %(condition)s \
					ORDER BY name ASC LIMIT 50', { condition: condition});
			}
		}
		
		// territory
		this.frm.fields_dict.territory.get_query = function() {
			return 'SELECT name, parent_territory FROM `tabTerritory` \
				WHERE ifnull(is_group, "No") = "No" AND docstatus != 2 \
				AND %(key)s LIKE \"%s\"	ORDER BY name ASC LIMIT 50';
		}
		
		this.frm.fields_dict.customer_address.on_new = function(docname) {
			me.on_new_master("Address", docname);
		}

		this.frm.fields_dict.contact_person.on_new = function(docname) {
			me.on_new_master("Contact", docname);
		}
	},
})