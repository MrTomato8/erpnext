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
from webnotes import _
from webnotes.utils import cstr, date_diff, flt, getdate, now
from webnotes.model.doc import make_autoname
from webnotes.model.utils import getlist
from webnotes.model.controller import get_obj
from webnotes import msgprint

import stock.utils
from controllers.selling_controller import SellingController

class DocType(SellingController):
	def setup(self):
		self.item_table_field = "sales_order_items"

	def validate(self):
		super(DocType, self).validate()
		self.validate_order_type()
		self.validate_po()
		#self.doclist = sales_com_obj.make_packing_list(self,'sales_order_items')
		self.set_item_actual_qty()
		
		if self.doc.docstatus == 1:
			self.stop_resume_transaction()

		self.doc.status='Draft'
		if not self.doc.billing_status: self.doc.billing_status = 'Not Billed'
		if not self.doc.delivery_status: self.doc.delivery_status = 'Not Delivered'

	def pull_quotation_items(self):
		self.doclist = self.doc.clear_table(self.doclist, self.item_table_field)
		self.doclist = self.doc.clear_table(self.doclist, 'taxes_and_charges')
		self.doclist = self.doc.clear_table(self.doclist, 'sales_team')
		
		if self.doc.quotation:
			mapper = webnotes.get_controller("DocType Mapper", "Quotation-Sales Order")
		
		import json
		from_to_list = [["Quotation", "Sales Order"], ["Quotation Item", "Sales Order Item"],
			["Sales Taxes and Charges", "Sales Taxes and Charges"], ["Sales Team", "Sales Team"]]
		
		mapper.dt_map("Quotation", "Sales Order", self.doc.quotation,
			self.doc, self.doclist, json.dumps(from_to_list))
			
	def check_maintenance_schedule(self):
		return webnotes.conn.sql("""select distinct parent from `tabMaintenance Schedule Item`
		 	where sales_order=%s and docstatus=1""", self.doc.name)

	def check_maintenance_visit(self):
		return webnotes.conn.sql("""select distinct parent from `tabMaintenance Visit Purpose`
			where sales_order=%s and t1.docstatus=1 
			and t1.completion_status='Fully Completed'""", self.doc.name)

	def validate_mandatory(self):
		super(DocType, self).validate_mandatory()
		if self.doc.delivery_date and \
				getdate(self.doc.posting_date) > getdate(self.doc.delivery_date):
			msgprint(_("Expected Delivery Date cannot be before Sales Order Date")
				, raise_exception=1)

	def validate_po(self):
		if self.doc.po_date and self.doc.delivery_date and \
				getdate(self.doc.po_date) > getdate(self.doc.delivery_date):
			msgprint(_("Expected Delivery Date cannot be before Purchase Order Date")
				, raise_exception=1)
			
		if self.doc.po_no and self.doc.customer:
			so = webnotes.conn.sql("""select name from `tabSales Order` 
				where ifnull(po_no, '') = %s and name != %s and docstatus < 2
				and customer = %s""", (self.doc.po_no, self.doc.name, self.doc.customer))
			if so and so[0][0]:
				msgprint(_("Another Sales Order (") + so[0][0] + 
					_(""") exists against same PO No and Customer. 
						Please be sure, you are not making duplicate entry."""))
						
	def validate_order_type(self):
		super(DocType, self).validate_order_type()
		
		if self.doc.order_type == 'Sales' and not self.doc.delivery_date:
			msgprint(_("Please enter Expected Delivery Date"), raise_exception=1)
	
	def validate_prevdoclist(self):
		from webnotes.model.mapper import validate_prev_doclist
		validate_prev_doclist("Quotation", "Sales Order", self.doclist)
		
	def update_opportunity_status(self, quotation, status):
		opportunity = webnotes.conn.sql("""select quote_item.opportunity 
			from `tabQuotation` quote, `tabQuotation Item` quote_item 
			where quote.name=quote_item.parent and quote.name=%s""", (quotation))
		if opportunity:
			webnotes.conn.get_value("Opportunity", opportunity, "status", status)
		
	def update_prevdoc_status(self):
		quotation_list = []
		for item in self.doclist.get({"parentfield": self.item_table_field}):
			if item.quotation and item.quotation not in quotation_list:
				quotation_list.append(item.quotation)
		
		for quotation in quotation_list:
			if self.doc.docstatus == 1:
				webnotes.conn.set_value("Quotation", item.quotation, "status", "Order Confirmed")
				self.update_opportunity_status(quotation, "Order Confirmed")
			elif self.doc.docstatus == 2:
				if not webnotes.conn.sql("""select so.name from `tabSales Order` so, 
						`tabSales Order Item` so_item where so.name = so_item.parent 
						and so_item.quotation=%s and so.name!=%s and so.docstatus=1"""
						, (quotation, self.doc.name)):
					webnotes.conn.set_value("Quotation", item.quotation, "status", "Submitted")
					self.update_opportunity_status(quotation, "Quotation Sent")

	def check_duplicate(self, item_doclist, stock_items, non_stock_items):
		from webnotes.model.utils import check_duplicate
		
		# prepare stock item fields for duplicate checking
		prevdoc_fields = webnotes.model.get_prevdoc_fields(self.doc.doctype)
		prevdoc_detail_fields = [(f + "_item") for f in prevdoc_fields]
		stock_item_fields = ["item_code", "description", "warehouse",
			"batch_no"] + prevdoc_fields + prevdoc_detail_fields
		
		# duplicate checking for stock items
		check_duplicate(item_doclist.get({"item_code": ["in", stock_items]}),
			stock_item_fields)
		
		# duplicate checking for non-stock items
		check_duplicate(item_doclist.get({"item_code": ["in", non_stock_items]}),
			["item_code", "description"])
			
	def set_item_actual_qty(self):
		for item in self.doclist.get({"parentfield": self.item_table_field}):
			if item.item_code and item.warehouse and item.item_code in self.stock_items:
				qty = stock.utils.get_actual_qty({"item_code": item.item_code, 
					"warehouse": item.warehouse, "posting_date": self.doc.posting_date,
					"posting_time": self.doc.posting_time or ""})
				item.actual_qty = qty["actual_qty"]
	
	def on_submit(self):
		super(DocType, self).on_submit()
		
		self.update_bin()
		webnotes.conn.set_value("Customer", self.doc.customer, "last_sales_order", self.doc.name)
		
		# Check for Approving Authority
		# get_obj('Authorization Control').validate_approving_authority(self.doc.doctype, self.doc.grand_total, self)
		
		get_obj('Sales Common').check_credit(self,self.doc.grand_total)
		self.update_prevdoc_status()
	
	def on_cancel(self):
		super(DocType, self).on_cancel()
		self.check_if_stopped()
		self.update_bin()
		self.update_prevdoc_status()
		if self.doc.is_stopped == 1:
			webnotes.conn.set(self.doc, "is_stopped", 0)
	
		
	def update_bin(self):
		# to-do
		pass

	def get_item_list(self, clear):
		return get_obj('Sales Common').get_item_list( self, clear)