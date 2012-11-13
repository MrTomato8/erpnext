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

wn.require('public/app/js/selling.js');
wn.provide("erpnext.selling");

erpnext.selling.Quotation = erpnext.Selling.extend({
	onload: function() {
		this._super();
	},
	
	refresh: function() {
		this._super();
		this.add_buttons();
		this.toggle_fields();
	},
	
	validate: function() {
		this._super()
		this.validate_quotation_to();
	},
	
	validate_quotation_to: function() {
		if(this.frm.doc.quotation_to == "Lead" && !this.frm.doc.lead) {
			msgprint("Lead is mandatory");
			validated = false;
		} else if (this.frm.doc.quotation_to == "Customer" && !this.frm.doc.customer) {
			msgprint("Customer is mandatory");
			validated = false;
		}
	},
	
	toggle_fields: function() {
		this._super();
		var lead_fields = ['lead_name', 'organization', 'territory'];
		this.frm.toggle_display("customer", this.frm.doc.quotation_to == "Customer");
		this.frm.toggle_display("lead", this.frm.doc.quotation_to == "Lead");
		this.frm.toggle_display(lead_fields, this.frm.doc.lead);
	},
	
	quotation_to: function() {
		related_fields = ['lead', 'lead_name','customer', 'customer_address', 
			'contact_person', 'customer_name', 'address_display', 'contact_display',
			 'contact_mobile', 'contact_email', 'territory','customer_group', 'organization'];
		for (fld in related_fields) {
			this.frm.doc.fields[fld] = "";
		}
		this.toggle_fields();
	},
	
	add_buttons: function() {
		var me = this;
		if(this.frm.doc.docstatus == 1 && this.frm.doc.status != "Order Lost") {
			this.frm.add_custom_button("Make Sales Order", 
				function() { me.make_sales_order(this); });
			this.frm.add_custom_button("Set as Lost", 
				function() { me.set_as_lost(this); });
			this.frm.add_custom_button("Send SMS", this.send_sms); // to-do
		}
	},
	
	make_sales_order: function() {
		wn.model.map_doclist([["Quotation", "Sales Order"], 
			["Quotation Item", "Sales Order Item"],
		 	["Sales Taxes and Charges", "Sales Taxes and Charges"], 
			["Sales Team", "Sales Team"]], this.frm.doc.name);
	},
	
	set_as_lost: function() {
		var lost_reason_dialog;
		if(!lost_reason_dialog) {
			lost_reason_dialog = new erpnext.InputDialog("Add Quotation Lost Reason", 
				"Reason", "declare_order_lost");
		}
		lost_reason_dialog.show();
	},
	
	lead: function() {
		if(this.frm.doc.lead) {
			get_server_fields('get_lead_details', this.frm.doc.lead, '', this.frm.doc, 
				this.frm.doc.doctype, this.frm.doc.name, 1);
		}
	},
	
	pull_opportunity_items: function(){
		var me = this;
		wn.call({
			doc: me.frm.doc,
			method: "pull_opportunity_items",
			callback: function(r, rt) {
				me.refresh();
			}
		});
	},
	
	setup_get_query: function() {
		this._super();
		var me = this;
		
		//lead
		this.frm.fields_dict['lead'].get_query = function() {
			return "SELECT name, lead_name FROM tabLead \
				WHERE %(key)s LIKE \"%s\" ORDER BY name ASC LIMIT 50";
		}
		
		// opportunity
		this.frm.fields_dict['opportunity'].get_query = function() {
			var condition = "";
			if(me.frm.doc.order_type) {
				condition += " AND ifnull(enquiry_type, '') = '" + me.frm.doc.order_type + "'";
			}
			if(me.frm.doc.customer) {
				condition += " AND customer = '" + me.frm.doc.customer + "'";
			} else if(me.frm.doc.lead) {
				condition += " AND lead = '" + me.frm.doc.lead + "'";
			}
			
			return "SELECT name FROM tabOpportunity WHERE docstatus = 1 \
				AND status = 'Submitted' AND %(key)s like \"%s\"" + condition + 
				"ORDER BY name ASC LIMIT 50";
		}
		
		// item code
		this.frm.fields_dict[this.item_table_field].grid.get_field('item_code')
				.get_query = function() {
			if(me.frm.doc.order_type == "Maintenance") {
				var condition = "infull(item.is_service_item, 'No')='Yes'";
			} else {
				var condition = "ifnull(item.is_sales_item, 'No')='Yes'";
			}
			
			if(me.frm.doc.customer) {
				var print_rate_field = wn.meta.get_docfield(me.frm.doctype, 
					'print_rate', me.frm.doc.name);
				var precision = (print_rate_field && 
					print_rate_field.fieldtype === 'Float') ? 6 : 2;
				var query = repl("\
					select \
						item.name, \
						( \
							select concat('Last Quote @ ', q.currency, ' ', \
								format(q_item.print_rate, %(precision)s)) \
							from `tabQuotation` q, `tabQuotation Item` q_item \
							where \
								q.name = q_item.parent and q_item.item_code = item.name \
								and q.docstatus = 1 and q.customer = \"%(customer)s\" \
							order by q.posting_date desc limit 1 \
						) as quote_rate, \
						( \
							select concat('Last Sale @ ', si.currency, ' ', \
								format(si_item.rate, %(precision)s)) \
							from `tabSales Invoice` si, `tabSales Invoice Item` si_item \
							where \
								si.name = si_item.parent and si_item.item_code = item.name \
								and si.docstatus = 1 and si.customer = \"%(cust)s\" \
							order by si.voucher_date desc limit 1 \
						) as sales_rate, \
						item.item_name, item.description \
					from `tabItem` item \
					where \
						%(condition)s and item.%(key)s like \"%s\" \
					limit 25", {
						customer: me.frm.doc.customer,
						condition: condition,
						precision: precision
					}
				);
			} else {
				var query = repl("\
					SELECT name, item_name, description \
					FROM `tabItem` item \
					WHERE %(condition)s and item.%(key)s LIKE '%s' \
					ORDER BY item.item_code DESC LIMIT 50", {condition: condition});
			}
			return query;
		}
	},
})

cur_frm.cscript = new erpnext.selling.Quotation({
	frm: cur_frm, item_table_field: "quotation_items"});