# ERPNext - web based ERP (http://erpnext.com)
# Copyright (C) 2012 Web Notes Technologies Pvt Ltd
# 
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# 
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
# 
# You should have received a copy of the GNU General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

from __future__ import unicode_literals
import webnotes
import webnotes.model
from webnotes import _, msgprint, DictObj
from webnotes.utils import add_days, getdate, flt, cint
from webnotes.model.controller import get_obj

import stock.utils
from controllers.accounts_controller import AccountsController

class BuyingController(AccountsController):
	def validate(self):
		super(BuyingController, self).validate()
		self.set_item_values()

	def get_item_details(self, args, item=None):
		args, item = self.process_args(args, item)
		
		ret = super(BuyingController, self).get_item_details(args, item)
		
		ret.min_order_qty = flt(item.doc.min_order_qty, self.precision.item.min_order_qty)
		
		if ret.warehouse:
			ret.projected_qty = stock.utils.get_projected_qty(args.item_code,
				ret.warehouse)["projected_qty"]
		
		if self.doc.posting_date and item.doc.lead_time_days:
			ret.schedule_date = add_days(self.doc.posting_date, item.doc.lead_time_days)
			ret.leat_time_date = ret.schedule_date
			
		# TODO last purchase details for PO and Pur Receipt
		
		# TODO supplier part no for PO
		
		return ret
		

	def validate_stock_item(self, item, child):
		super(BuyingController, self).validate_stock_item(item, child)
		
		if item.is_purchase_item != "Yes" and item.is_subcontracted_item != "Yes":
			msgprint(_("""Row # %(idx)s, Item %(item_code)s: \
				Not a Purchase / Sub-contracted Item""") % \
				{"idx": child.idx, "item_code": item.name },
				raise_exception=1)
				
	def check_duplicate(self, item_doclist, stock_items, non_stock_items):
		from webnotes.model.utils import check_duplicate
		
		# prepare stock item fields for duplicate checking
		prevdoc_fields = webnotes.model.get_prevdoc_fields(self.doc.doctype)
		prevdoc_detail_fields = [(f + "_item") for f in prevdoc_fields]
		stock_item_fields = ["schedule_date", "item_code", "description", "warehouse",
			"batch_no"] + prevdoc_fields + prevdoc_detail_fields
		
		# duplicate checking for stock items
		check_duplicate(item_doclist.get({"item_code": ["in", stock_items]}),
			stock_item_fields)
		
		# duplicate checking for non-stock items
		check_duplicate(item_doclist.get({"item_code": ["in", non_stock_items]}),
			["schedule_date", "item_code", "description"])
	
	def set_schedule_date(self, item_table_field=None):
		"""set schedule date in items as posting_date + lead_time_days"""
		prevdoc_fields = webnotes.model.get_prevdoc_fields(self.doc.doctype)
		
		if not item_table_field:
			item_table_field = webnotes.form_dict.get("item_table_field") or \
				self.item_table_field
		
		for d in self.doclist.get({"parenfield": item_table_field}):
			lead_time_days = webnotes.conn.sql("""select ifnull(lead_time_days, 0)
				from `tabItem` where name=%s and (ifnull(end_of_life, "")="" 
				or end_of_life="0000-00-00" or end_of_life > now())""", (d.item_code,))
			lead_time_days = lead_time_days and cint(lead_time_days[0][0]) or 0

			if lead_time_days:
				d.lead_time_date = add_days(self.doc.posting_date, lead_time_days)
				if not any([d.fields.get(f) for f in prevdoc_fields]):
					# i.e. if not mapped using doctype mapper
					d.schedule_date = add_days(self.doc.posting_date, lead_time_days)
					
	def set_item_values(self):
		for item in self.doclist.get({"parentfield": self.item_table_field}):
			# set projected qty
			item.projected_qty = stock.utils.get_projected_qty(item.item_code,
				item.warehouse).get("projected_qty")
		
	def get_last_purchase_details(self, item_code, doc_name):
		query = """select parent.name, parent.posting_date, item.conversion_factor,
			item.ref_rate, item.discount, item.rate %s
			from `tab%s` parent, `tab%s` item
			where parent.name = item.parent and item.item_code = %s 
			and parent.docstatus = 1 and parent.name != %s
			order by parent.posting_date desc, %s parent.name desc limit 1"""
			
		last_purchase_order_item = webnotes.conn.sql(query % \
			("Purchase Order", "Purchase Order Item", "%s", "%s", ""),
			(item_code, doc_name), as_dict=1)
		
		last_purchase_receipt_item = webnotes.conn.sql(query % \
			("Purchase Receipt", "Purchase Receipt Item", "%s", "%s",
			"parent.posting_time desc, "), (item_code, doc_name), as_dict=1)
		
		# get the last purchased item, by comparing dates	
		if last_purchase_order_item and last_purchase_receipt_item:
			purchase_order_date = getdate(last_purchase_order_item[0].posting_date)
			purchase_receipt_date = getdate(last_purchase_receipt_item[0].posting_date)
			if purchase_order_date > purchase_receipt_date:
				last_purchase_item = last_purchase_order_item[0]
			else:
				last_purchase_item = last_purchase_receipt_item[0]
		elif last_purchase_order_item:
			last_purchase_item = last_purchase_order_item[0]
		elif last_purchase_receipt_item:
			last_purchase_item = last_purchase_receipt_item[0]
		else:
			# if none exists
			return DictObj(), getdate("2000-01-01")
		
		last_purchase_date = getdate(last_purchase_item.posting_date)
		conversion_factor = flt(last_purchase_item.conversion_factor)
		
		# prepare last purchase details, dividing by conversion factor
		last_purchase_details = DictObj({
			"ref_rate": flt((last_purchase_item.ref_rate / conversion_factor),
				self.precision.item.ref_rate),
			"rate": flt((last_purchase_item.rate / conversion_factor),
				self.precision.item.rate),
			"discount": flt(last_purchase_item.discount, self.precision.item.discount),
			"last_purchase_date": last_purchase_date
		})
		
		return last_purchase_details
		
	def append_default_taxes(self):
		"""called in on_map to add rows in tax table when they are missing"""
		if not (self.doc.supplier or 
				len(self.doclist.get({"parentfield": "taxes_and_charges"}))):
			self.doc.taxes_and_charges_master = webnotes.conn.get_value(
				"Purchase Taxes and Charges Master", {"is_default[0]": 1}, "name")
			
			if not self.doc.taxes_and_charges_master: return
			
			self.append_taxes()
			
	def get_supplier_details(self, args):
		self.set_address(args)
		self.set_contact(args)
	
		res = webnotes.conn.sql("""select supplier_name, default_currency
			from `tabSupplier` where name=%s and docstatus < 2""",
			(args.get("supplier"),))
	
		if res:
			self.doc.supplier_name = res[0][0]
			self.doc.currency = res[0][1]
			
	def set_valuation_tax_amount(self, item, tax, current_tax_amount):
		if tax.category in ["Valuation", "Valuation and Total"] and \
				item.item_code in self.stock_items:
			item.valuation_tax_amount += flt(current_tax_amount,
				self.precision.item.valuation_tax_amount)
