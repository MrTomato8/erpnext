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
from webnotes.utils import cint, formatdate, cstr, flt
from webnotes.model.controller import get_obj
from webnotes.model.doc import make_autoname, Document
import json

import stock.utils

from webnotes.model.controller import DocListController

class TransactionController(DocListController):
	def __init__(self, doc, doclist):
		super(TransactionController, self).__init__(doc, doclist)
		self.cur_docstatus = cint(webnotes.conn.get_value(self.doc.doctype, 
			self.doc.name, "docstatus"))
		
	def autoname(self):
		self.doc.name = make_autoname(self.doc.naming_series+'.#####')
	
	def validate(self):
		self.validate_fiscal_year()
		self.validate_mandatory()
		self.validate_items()
		
		if self.doc.docstatus == 1 and self.cur_docstatus == 0:
			# a doc getting submitted should not be stopped
			self.doc.is_stopped = 0
		
		if self.doc.docstatus == 1:
			if self.meta.get_field("is_stopped"):
				self.stop_resume_transaction()
			
		if self.meta.get_field("taxes_and_charges"):
			self.calculate_taxes_and_totals()
			
	def on_map(self):
		self.set_item_values()
		self.append_default_taxes()

	def on_update(self):
		pass
		
	def on_submit(self):
		pass
	
	def on_cancel(self):
		self.is_next_submitted()
	
	@property
	def precision(self):
		if not hasattr(self, "_precision"):
			self._precision = DictObj()
			self._precision.main = self.meta.get_precision_map()
			self._precision.item = self.meta.get_precision_map(parentfield = \
				self.item_table_field)
			if self.meta.get_field("taxes_and_charges"):
				self._precision.tax = self.meta.get_precision_map(parentfield = \
					"taxes_and_charges")
		return self._precision
		
	@property
	def item_doclist(self):
		if not hasattr(self, "_item_doclist"):
			self._item_doclist = self.doclist.get({"parentfield": self.item_table_field})
		return self._item_doclist

	@property
	def tax_doclist(self):
		if not hasattr(self, "_tax_doclist"):
			self._tax_doclist = self.doclist.get({"parentfield": "taxes_and_charges"})
		return self._tax_doclist
	
	def set_item_values(self):
		for item in self.doclist.get({"parentfield": self.item_table_field}):
			item_values = self.get_item_details({"item_code": item.item_code})
			for k in item_values:
				if not item.fields.get(k):
					item.fields[k] = item_values[k]
	
	def stop_resume_transaction(self):
		"""stop/resume a transaction if there is a change in is_stopped"""
		self.doc.is_stopped = cint(self.doc.is_stopped)
		is_stopped_old = webnotes.conn.get_value(self.doc.doctype, self.doc.name,
			"is_stopped")
		
		if self.doc.is_stopped != cint(is_stopped_old):
			# TODO deprecate bin
			self.update_bin()

			msgprint("%(doctype)s: %(name)s %(stopped)s." % {
				"doctype": _(self.doc.doctype),
				"name": self.doc.name,
				"stopped": self.doc.is_stopped and _("stopped") or _("resumed")
			})
			
	def validate_mandatory(self):
		if self.doc.amended_from and not self.doc.amendment_date:
			msgprint(_("Please specify") + ": %(label)s" % \
				{"label": self.meta.get_label("amendment_date")}, raise_exception=1)
			
	def validate_fiscal_year(self):
		# TODO: fiscal_year field needs to be deprecated
		from accounts.utils import get_fiscal_year
		if get_fiscal_year(self.doc.posting_date)[0] != self.doc.fiscal_year:
			msgprint("%(posting_date)s: " + _("not within Fiscal Year") + \
				": %(fiscal_year)s" % {
					"posting_date": formatdate(self.doc.posting_date),
					"fiscal_year": self.doc.fiscal_year
				}, raise_exception=1)
			
	def validate_items(self):
		"""
			validate the following:
			* qty >= 0
			* stock item
			* duplicate rows
			* mapping with previous doclist
		"""
		from webnotes.model.utils import validate_condition
		
		stock_items = []
		non_stock_items = []
		
		for item in self.item_doclist:
			# validate qty
			validate_condition(item, "qty", ">=", 0)
			
			item_controller = get_obj("Item", item.item_code)
			
			# validations for stock item
			self.validate_stock_item(item_controller.doc, item)
			
			# separate out stock and non-stop items for duplicate checking
			if item_controller.doc.is_stock_item == "Yes":
				stock_items.append(item_controller.doc.name)
			else:
				non_stock_items.append(item_controller.doc.name)
		
		self.check_duplicate(self.item_doclist, stock_items, non_stock_items)
		
		# to be overridden in each controller
		self.validate_prevdoclist()
		
	def validate_stock_item(self, item, child):
		stock.utils.validate_end_of_life(item.name, item.end_of_life)
		
		# get warehouse field
		warehouse_field = webnotes.get_field(child.parenttype, "warehouse",
			parentfield=child.parentfield)
		
		if warehouse_field and item.is_stock_item == "Yes" and not child.warehouse:
			msgprint((_("Row") + " # %(idx)s, " + _("Item") + " %(item_code)s: " + \
				_("Please specify Warehouse for Stock Item")) % \
				{"idx": child.idx, "item_code": item.name },
				raise_exception=1)
			
	def get_item_details(self, args, item=None):
		# validate end of life
		stock.utils.validate_end_of_life(item.doc.item_code, item.doc.end_of_life)

		ret = DictObj({
			"item_name": item.doc.item_name,
			"item_group": item.doc.item_group,
			"brand": item.doc.brand,
			"description": item.doc.description,
			"uom": item.doc.stock_uom,
			"stock_uom": item.doc.stock_uom,
			"warehouse": args.warehouse or item.doc.default_warehouse,
			"conversion_factor": 1,
			"qty": 0,
			"discount": 0,
			"amount": 0,
			"print_amount": 0,
			"serial_no": "",
			"batch_no": "",
			"item_tax_rate": json.dumps(dict((item_tax.tax_type, item_tax.tax_rate)
				for item_tax in item.doclist.get({"parentfield": "item_tax"}))),
		})
		
		return ret
		
	def process_args(self, args, item=None):
		if isinstance(args, basestring):
			args = json.loads(args)

		args = DictObj(args)

		if not item:
			item = get_obj("Item", args.item_code, with_children=1)

		return args, item
	
	@property
	def stock_items(self):
		if not hasattr(self, "_stock_items"):
			item_codes = list(set(item.item_code for item in self.item_doclist))
			self._stock_items = [r[0] for r in webnotes.conn.sql("""select name
				from `tabItem` where name in (%s) and is_stock_item='Yes'""" % \
				(", ".join((["%s"]*len(item_codes))),), item_codes)]

		return self._stock_items
		
	def get_barcode_details(self, args):
		item = self.get_item_code(args["barcode"])
		ret = args.update({'item_code': item})
		if item:
			ret = self.get_item_details(ret)
			
		return ret
		
	def get_item_code(self, barcode):
		item = webnotes.conn.sql("""select name, end_of_life, is_sales_item,
			is_service_item from `tabItem` where barcode = %s""", barcode, as_dict=1)
		
		# perform validations
		if not item:
			msgprint(_("No item found for this barcode") + ": " + barcode + ". " + 
				_("May be barcode not updated in item master. Please check"),
				raise_exception=True)
		elif len(item) > 1:
			msgprint(_("""There are multiple item for this barcode. 
				Please select item code manually"""), raise_exception=True)

		stock.utils.validate_end_of_life(item[0].name, item[0].end_of_life)
		
		if item[0]['is_sales_item'] == 'No' and item[0]['is_service_item'] == 'No':
			msgprint(_("Item") + ": "+ item[0]['name'] + \
				_(" is not a sales or service item"), raise_exception=True)
		
		return item[0]["name"]
	
	def get_uom_details(self, args=None):
		"""get last purchase rate based on conversion factor"""
		# QUESTION why is this function called in purchase request?
		if not args:
			args = webnotes.form_dict.get("args")
			
		if isinstance(args, basestring):
			args = json.loads(args)
		
		args = DictObj(args)
		ret = DictObj()
		
		conversion_factor = flt(webnotes.conn.get_value("UOM Conversion Detail", 
			{"parent": args.item_code, "uom": args.uom}, "conversion_factor"))
		if not conversion_factor: return ret
		
		last_purchase_details = self.get_last_purchase_details(args.item_code,
			args.doc_name)
		exchange_rate = flt(args.exchange_rate, self.precision.main.exchange_rate)
		ref_rate = last_purchase_details.ref_rate * conversion_factor or 0
		rate = last_purchase_details.rate * conversion_factor or 0
		
		# TODO: check why stock_qty and not qty
		ret.update({
			"conversion_factor": conversion_factor,
			"qty": flt(flt(args.stock_qty, self.precision.item.stock_qty) / 
				conversion_factor, self.precision.item.qty),
			"ref_rate": ref_rate,
			"rate": rate,
			"print_ref_rate": ref_rate / exchange_rate,
			"print_rate": rate / exchange_rate,
		})
		
		return ret
		
	def get_tc_details(self):
		terms = webnotes.conn.get_value("Terms and Conditions", self.doc.tc_name,
			"terms")
		if terms:
			self.doc.terms = terms
	
	def is_next_submitted(self):
		from webnotes.model.mapper import is_next_submitted
		is_next_submitted(self.doc.doctype, self.doc.name)
	
	def set_address(self, args):
		address = self.get_address(args)
		
		if not address:
			return
		
		if args.get("is_shipping_address"):
			self.doc.shipping_address_name = address["name"]
			self.doc.shipping_address = address["address_display"]
		else:
			self.doc.supplier_address = address["name"]
			self.doc.customer_address = address["name"]
			self.doc.address_display = address["address_display"]
			
	def get_address(self, args):
		args = DictObj(args)
		
		query = "select * from `tabAddress` where docstatus < 2 "
		
		if args.customer:
			query += "and customer=%s order by "
			if args.is_shipping_address:
				query += "is_shipping_address desc, "
			query += "is_primary_address desc limit 1"
			val = args.customer
		elif args.supplier:
			query += "and supplier=%s order by "
			if args.is_shipping_address:
				query += "is_shipping_address desc, "
			query += "is_primary_address desc limit 1"
			val = args.supplier
		else:
			query += "and name=%s"
			val = args.name
		
		address_result = webnotes.conn.sql(query, (val,), as_dict=1)
		
		if address_result:
			address_doc = Document("Address", fielddata=address_result[0])
			
			address_display = "\n".join(filter(None, [
				address_doc.address_line1,
				address_doc.address_line2,
				" ".join(filter(None, [address_doc.city, address_doc.pincode])),
				address_doc.state,
				address_doc.country,
				address_doc.phone and ("Phone: %s" % address_doc.phone) or "",
				address_doc.fax and ("Fax: %s" % address_doc.fax) or "",
			]))
			
			# send it on client side - can be used for further processing
			webnotes.response.setdefault("docs", []).append(address_doc)
			
			return {
				"name": address_doc.name, 
				"address_display": address_display
			}

	def set_contact(self, args):
		args = DictObj(args)
		contact_field = self.meta.get_field({"options": "^Contact"})

		query = "select * from `tabContact` where docstatus < 2 "
		
		if args.customer:
			query += "and customer=%s order by is_primary_contact desc limit 1"
			val = args.customer
		elif args.supplier:
			query += "and supplier=%s order by is_primary_contact desc limit 1"
			val = args.supplier
		else:
			query += "and name=%s"
			val = self.doc.fields.get(contact_field)
			
		contact_result = webnotes.conn.sql(query, (val,), as_dict=1)
		
		if contact_result:
			contact_doc = Document("Contact", fielddata=contact_result[0])
			
			self.doc.fields[contact_field.fieldname] = contact_doc.name
			
			self.doc.contact_display = " ".join(filter(None, 
				[contact_doc.first_name, contact_doc.last_name]))
			
			self.doc.contact_person = contact_doc.name
			self.doc.contact_email = contact_doc.email_id
			self.doc.contact_mobile = contact_doc.mobile_no
			self.doc.contact_designation = contact_doc.designation
			self.doc.contact_department = contact_doc.department
			
			# send it on client side - can be used for further processing
			webnotes.response.setdefault("docs", []).append(contact_doc)
			
	